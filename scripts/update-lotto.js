// scripts/update-lotto.js
const fs = require('fs');
const path = require('path');

const HISTORY_PATH = path.join(__dirname, '../data/lotto-history.json');

async function fetchWithTimeout(url, timeoutMs = 10000, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// 네이버 모바일 검색 파싱 함수
async function fetchFromNaver(round) {
  const url = `https://m.search.naver.com/search.naver?query=${encodeURIComponent(`로또 ${round}회`)}`;
  try {
    const res = await fetchWithTimeout(url, 10000, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });
    if (!res.ok) return null;
    const html = await res.text();

    // 회차 검증 (아직 미추첨 회차이거나 과거 회차를 노출하는 경우 방지)
    const roundRegex = new RegExp(`(?:제\\s*)?${round}\\s*회`);
    if (!roundRegex.test(html)) {
      return null;
    }

    let winNums = [];
    let bonusNum = null;

    // 1차: win_num 및 bonus_num 영역 매칭
    const winMatch = html.match(/<div class="(?:win_num|num_box)">([\s\S]*?)<\/div>/);
    const bonusMatch = html.match(/<div class="(?:bonus_num|num_bonus)">([\s\S]*?)<\/div>/);

    if (winMatch && bonusMatch) {
      const numRegex = />(\d+)</g;
      let m;
      while ((m = numRegex.exec(winMatch[1])) !== null) {
        winNums.push(Number(m[1]));
      }
      while ((m = numRegex.exec(bonusMatch[1])) !== null) {
        bonusNum = Number(m[1]);
      }
    }

    // 2차: span.num 태그 매칭 보완
    if (winNums.length !== 6 || bonusNum === null) {
      const spanRegex = /<span class="num[^>]*>(\d+)<\/span>/g;
      const allNums = [];
      let sm;
      while ((sm = spanRegex.exec(html)) !== null) {
        allNums.push(Number(sm[1]));
      }
      if (allNums.length >= 7) {
        winNums = allNums.slice(0, 6);
        bonusNum = allNums[6];
      }
    }

    if (winNums.length === 6 && bonusNum !== null && bonusNum >= 1 && bonusNum <= 45) {
      const valid = winNums.every(n => n >= 1 && n <= 45);
      if (valid) {
        return {
          round: Number(round),
          numbers: winNums.sort((a, b) => a - b),
          bonus: Number(bonusNum)
        };
      }
    }
  } catch (e) {
    console.log(`[네이버 파싱 오류] 제 ${round}회: ${e.message}`);
  }
  return null;
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

  // 내림차순(최신순) 정렬
  history.sort((a, b) => Number(b.round || 0) - Number(a.round || 0));

  const latestRecordedRound = history.length > 0 
    ? Math.max(...history.map(d => Number(d.round || 0))) 
    : 0;

  let targetRound = latestRecordedRound + 1;
  let hasNewData = false;

  console.log(`[정보] 현재 저장된 최신 회차: ${latestRecordedRound}회`);

  // 밀린 회차가 없을 때까지 연속 수집
  while (true) {
    console.log(`\n[진행] 제 ${targetRound}회차 네이버 수집 시도 중...`);

    const drawData = await fetchFromNaver(targetRound);

    if (drawData) {
      history.unshift(drawData);
      hasNewData = true;
      console.log(`[성공] 제 ${drawData.round}회 당첨번호 수집 완료:`, drawData.numbers, `+ 보너스 ${drawData.bonus}`);
      targetRound++;
      // 요청 간격 대기
      await new Promise(resolve => setTimeout(resolve, 1500));
    } else {
      console.log(`[종료] 제 ${targetRound}회차 결과를 찾을 수 없습니다. (추첨 전이거나 데이터 없음)`);
      break;
    }
  }

  if (hasNewData) {
    history.sort((a, b) => Number(b.round || 0) - Number(a.round || 0));
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 4), 'utf-8');
    console.log(`\n[완료] 최신 데이터가 lotto-history.json에 성공적으로 저장되었습니다.`);
  } else {
    console.log(`\n[완료] 추가할 새로운 회차가 없습니다.`);
  }
  console.log('==================================================');
}

run();
