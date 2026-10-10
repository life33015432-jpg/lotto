// scripts/update-lotto.js
const fs = require('fs');
const path = require('path');

const HISTORY_PATH = path.join(__dirname, '../data/lotto-history.json');

// 타임아웃 지원 fetch
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

// ----------------------------------------------------
// [1차] 네이버 모바일 검색 스크래핑
// ----------------------------------------------------
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

    const roundRegex = new RegExp(`(?:제\\s*)?${round}\\s*회`);
    if (!roundRegex.test(html)) return null;

    let winNums = [];
    let bonusNum = null;

    // 모바일 당첨번호 박스 구조 매칭
    const winMatch = html.match(/<div class="(?:win_num|num_box)">([\s\S]*?)<\/div>/);
    const bonusMatch = html.match(/<div class="(?:bonus_num|num_bonus)">([\s\S]*?)<\/div>/);

    if (winMatch && bonusMatch) {
      const numRegex = />(\d+)</g;
      let m;
      while ((m = numRegex.exec(winMatch[1])) !== null) winNums.push(Number(m[1]));
      while ((m = numRegex.exec(bonusMatch[1])) !== null) bonusNum = Number(m[1]);
    }

    // span.num 대체 구조 매칭
    if (winNums.length !== 6 || bonusNum === null) {
      const spanRegex = /<span class="num[^>]*>(\d+)<\/span>/g;
      const allNums = [];
      let sm;
      while ((sm = spanRegex.exec(html)) !== null) allNums.push(Number(sm[1]));
      if (allNums.length >= 7) {
        winNums = allNums.slice(0, 6);
        bonusNum = allNums[6];
      }
    }

    if (winNums.length === 6 && bonusNum !== null && bonusNum >= 1 && bonusNum <= 45) {
      if (winNums.every(n => n >= 1 && n <= 45)) {
        return {
          round: Number(round),
          numbers: winNums.sort((a, b) => a - b),
          bonus: Number(bonusNum)
        };
      }
    }
  } catch (e) {
    console.log(`[네이버 조회 예외] 제 ${round}회: ${e.message}`);
  }
  return null;
}

// ----------------------------------------------------
// [2차] 구글 검색 결과 및 스니펫 파싱
// ----------------------------------------------------
async function fetchFromGoogle(round) {
  const url = `https://www.google.com/search?q=${encodeURIComponent(`로또 ${round}회`)}&hl=ko&gl=kr`;
  try {
    const res = await fetchWithTimeout(url, 10000, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9'
      }
    });
    if (!res.ok) return null;
    const html = await res.text();

    const roundRegex = new RegExp(`(?:제\\s*)?${round}\\s*회`);
    if (!roundRegex.test(html)) return null;

    // 1) 텍스트 패턴 (예: "당첨번호는 4, 5, 25, 28, 32, 42", "보너스 번호는 12")
    const patternA = /(?:당첨번호(?:는)?|1등\s*번호)\s*[:은]?\s*([0-9\s,·\.\-]+?)(?:이며|이고|\s+|\.|\,)\s*보너스(?:\s*번호(?:는)?)?\s*[:은]?\s*(\d{1,2})/i;
    let match = html.match(patternA);

    // 2) 기사 헤드라인 패턴 (예: "'4·5·25·28·32·42'…보너스 번호는 '12'")
    if (!match) {
      const patternB = /['"‘“]?([0-9\s,·\.\-]+)['"’”]?[\s\S]*?보너스(?:\s*번호)?(?:\s*는)?\s*['"‘“]?(\d{1,2})/i;
      match = html.match(patternB);
    }

    if (match) {
      const rawWins = match[1];
      const bonusNum = Number(match[2]);

      const extractedNums = rawWins.match(/\b([1-9]|[1-3][0-9]|4[0-5])\b/g);
      if (extractedNums && extractedNums.length >= 6) {
        const winNums = extractedNums.slice(0, 6).map(Number);
        if (winNums.every(n => n >= 1 && n <= 45) && bonusNum >= 1 && bonusNum <= 45) {
          return {
            round: Number(round),
            numbers: winNums.sort((a, b) => a - b),
            bonus: bonusNum
          };
        }
      }
    }
  } catch (e) {
    console.log(`[구글 조회 예외] 제 ${round}회: ${e.message}`);
  }
  return null;
}

// 통합 검색 핸들러 (1차 네이버 -> 실패 시 2차 구글)
async function fetchRoundData(round) {
  console.log(`  [1차 시도] 네이버에서 '로또 ${round}회' 검색 중...`);
  let data = await fetchFromNaver(round);
  if (data) return { source: '네이버', data };

  console.log(`  [2차 시도] 네이버 미반영/실패 -> 구글에서 '로또 ${round}회' 검색 중...`);
  data = await fetchFromGoogle(round);
  if (data) return { source: '구글', data };

  return null;
}

// ----------------------------------------------------
// 메인 실행부
// ----------------------------------------------------
async function run() {
  console.log('==================================================');
  console.log('[작업 시작] 로또 회차 자동 수집 (1차 네이버 / 2차 구글)');
  console.log('==================================================');

  let history = [];
  if (fs.existsSync(HISTORY_PATH)) {
    const raw = fs.readFileSync(HISTORY_PATH, 'utf-8');
    try {
      history = JSON.parse(raw);
    } catch (e) {
      console.error('기존 JSON 파일 파싱 에러:', e.message);
      history = [];
    }
  }

  // 최신순 정렬
  history.sort((a, b) => Number(b.round || 0) - Number(a.round || 0));

  const latestRecordedRound = history.length > 0 
    ? Math.max(...history.map(d => Number(d.round || 0))) 
    : 0;

  // 기존 최신 회차에 +1 하여 순차 탐색
  let targetRound = latestRecordedRound + 1;
  let hasNewData = false;

  console.log(`[정보] 현재 저장된 최신 회차: ${latestRecordedRound}회`);

  while (true) {
    console.log(`\n[진행] 제 ${targetRound}회차 탐색을 시작합니다.`);
    const result = await fetchRoundData(targetRound);

    if (result && result.data) {
      const drawData = result.data;
      history.unshift(drawData);
      hasNewData = true;
      console.log(`[성공] (${result.source}) 제 ${drawData.round}회 수집 완료:`, drawData.numbers, `+ 보너스 ${drawData.bonus}`);
      
      targetRound++; // 다음 누락 회차(+1) 계속 탐색
      await new Promise(resolve => setTimeout(resolve, 1500));
    } else {
      console.log(`[종료] 제 ${targetRound}회차 결과를 찾을 수 없습니다. (미추첨 상태이거나 포털 미반영)`);
      break;
    }
  }

  if (hasNewData) {
    // 중복 제거 및 회차 내림차순 정렬
    const uniqueMap = new Map();
    history.forEach(item => {
      if (item && item.round) uniqueMap.set(Number(item.round), item);
    });
    const finalHistory = Array.from(uniqueMap.values()).sort((a, b) => Number(b.round) - Number(a.round));

    fs.writeFileSync(HISTORY_PATH, JSON.stringify(finalHistory, null, 4), 'utf-8');
    console.log(`\n[완료] 최신 회차가 lotto-history.json에 성공적으로 저장되었습니다.`);
  } else {
    console.log(`\n[완료] 업데이트할 새로운 회차가 없습니다.`);
  }
  console.log('==================================================');
}

run();
