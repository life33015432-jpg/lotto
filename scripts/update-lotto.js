// scripts/update-lotto.js
const fs = require('fs');
const path = require('path');

const HISTORY_PATH = path.join(__dirname, '../data/lotto-history.json');

async function fetchWithTimeout(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function run() {
  console.log('==================================================');
  console.log('[작업 시작] 네이버 검색 기반 로또 회차 자동 수집');
  console.log('==================================================');

  let history = [];
  if (fs.existsSync(HISTORY_PATH)) {
    const raw = fs.readFileSync(HISTORY_PATH, 'utf-8');
    history = JSON.parse(raw);
  }

  // 내림차순(최신순) 정렬 보장
  history.sort((a, b) => Number(b.round || 0) - Number(a.round || 0));

  const latestRecordedRound = history.length > 0 
    ? Math.max(...history.map(d => Number(d.round || 0))) 
    : 0;
  let targetRound = latestRecordedRound + 1;
  let hasNewData = false;

  while (true) {
    console.log(`\n[진행] 제 ${targetRound}회차 네이버 수집 시도 중...`);
    const url = `https://m.search.naver.com/search.naver?query=로또+${targetRound}회`;
    
    let res;
    try {
      res = await fetchWithTimeout(url, 10000);
    } catch (e) {
      console.log(`[오류] 통신 지연 또는 실패: ${e.message}. 다음 주기에 재시도합니다.`);
      break;
    }

    if (!res.ok) {
      console.log(`[오류] HTTP ${res.status} 반환. 수집을 일시 중단합니다.`);
      break;
    }

    const html = await res.text();

    // 네이버 로또 당첨번호 정규식 파싱
    const winNumMatch = html.match(/<div class="win_num">([\s\S]*?)<\/div>/) || html.match(/<div class="num_box">([\s\S]*?)<\/div>/);
    const bonusNumMatch = html.match(/<div class="bonus_num">([\s\S]*?)<\/div>/);

    if (!winNumMatch || !bonusNumMatch) {
      console.log(`[종료] 제 ${targetRound}회차 결과를 찾을 수 없습니다. (아직 추첨 전이거나 데이터 없음)`);
      break;
    }

    // 숫자만 추출
    const numRegex = />(\d+)</g;
    const winNums = [];
    let match;
    while ((match = numRegex.exec(winNumMatch[1])) !== null) {
      winNums.push(Number(match[1]));
    }

    const bonusNums = [];
    while ((match = numRegex.exec(bonusNumMatch[1])) !== null) {
      bonusNums.push(Number(match[1]));
    }

    if (winNums.length !== 6 || bonusNums.length !== 1) {
      console.log(`[오류] 파싱된 번호 개수가 비정상입니다. (당첨: ${winNums.length}개, 보너스: ${bonusNums.length}개)`);
      break;
    }

    const newDraw = {
      round: targetRound,
      numbers: winNums.sort((a, b) => a - b),
      bonus: bonusNums[0]
    };

    history.unshift(newDraw);
    hasNewData = true;
    console.log(`[성공] 제 ${newDraw.round}회 당첨번호 수집 완료:`, newDraw.numbers, `+ 보너스 ${newDraw.bonus}`);
    
    targetRound++;
    
    // 봇 차단 방지를 위한 약간의 딜레이
    await new Promise(r => setTimeout(r, 1500));
  }

  if (hasNewData) {
    history.sort((a, b) => Number(b.round || 0) - Number(a.round || 0));
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 4), 'utf-8');
    console.log(`\n[완료] 새로운 회차 데이터가 성공적으로 저장되었습니다.`);
  } else {
    console.log(`\n[완료] 추가할 새로운 회차가 없습니다.`);
  }
  console.log('==================================================');
}

run();
