// scripts/update-lotto.js
const fs = require('fs');
const path = require('path');

const HISTORY_PATH = path.join(__dirname, '../data/lotto-history.json');

async function fetchWithTimeout(url, headers = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9',
        ...headers
      }
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// 1차: 네이버 모바일 검색 결과 자동 파싱
async function fetchFromNaver(targetRound) {
  const url = `https://m.search.naver.com/search.naver?query=${encodeURIComponent(targetRound + '회 로또')}`;
  console.log(`[1차 시도] 네이버 자동 조회: ${url}`);
  
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  
  const html = await res.text();
  if (!html.includes(`${targetRound}회`)) {
    console.log(`[네이버] ${targetRound}회 정보 미반영`);
    return null;
  }

  const ballRegex = /<span class="(?:ball|num|win_ball)[^"]*">(\d{1,2})<\/span>/g;
  const numbers = [];
  let match;
  while ((match = ballRegex.exec(html)) !== null) {
    const num = Number(match[1]);
    if (num >= 1 && num <= 45) {
      numbers.push(num);
    }
    if (numbers.length >= 7) break;
  }

  if (numbers.length >= 7) {
    return {
      round: targetRound,
      numbers: numbers.slice(0, 6).sort((a, b) => a - b),
      bonus: numbers[6]
    };
  }
  return null;
}

// 2차: 동행복권 공식 API 백업 파싱
async function fetchFromDhlottery(targetRound) {
  const url = `https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=${targetRound}`;
  console.log(`[2차 시도] 동행복권 API 백업 조회: ${url}`);
  
  const res = await fetchWithTimeout(url, {
    'Accept': 'application/json, text/plain, */*'
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  
  const data = await res.json();
  if (data && data.returnValue === 'success') {
    return {
      round: Number(data.drwNo),
      numbers: [
        Number(data.drwtNo1),
        Number(data.drwtNo2),
        Number(data.drwtNo3),
        Number(data.drwtNo4),
        Number(data.drwtNo5),
        Number(data.drwtNo6)
      ].sort((a, b) => a - b),
      bonus: Number(data.bnusNo)
    };
  }
  return null;
}

async function run() {
  console.log('==================================================');
  console.log('[자동화 작업] 로또 회차 전자동 수집 및 JSON 갱신');
  console.log('==================================================');

  let history = [];
  if (fs.existsSync(HISTORY_PATH)) {
    history = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8'));
  }

  history.sort((a, b) => Number(b.round || 0) - Number(a.round || 0));
  const latestRound = history.length > 0 ? Number(history[0].round || 0) : 0;
  const targetRound = latestRound + 1;

  console.log(`[상태] 현재 저장 최신: ${latestRound}회 ➔ 자동 수집 대상: ${targetRound}회`);

  let newDraw = null;

  // 1순위: 네이버 조회
  try {
    newDraw = await fetchFromNaver(targetRound);
  } catch (e) {
    console.log(`[네이버 실패] ${e.message}`);
  }

  // 2순위: 동행복권 백업
  if (!newDraw) {
    try {
      newDraw = await fetchFromDhlottery(targetRound);
    } catch (e) {
      console.log(`[동행복권 실패] ${e.message}`);
    }
  }

  if (!newDraw) {
    console.log(`[대기] ${targetRound}회 추첨 결과 미공개 또는 수집 실패. 다음 크론 주기에서 자동 재시도합니다.`);
    return;
  }

  // 중복 배제 및 최신순 재배열
  history = history.filter(item => Number(item.round) !== newDraw.round);
  history.unshift(newDraw);
  history.sort((a, b) => Number(b.round || 0) - Number(a.round || 0));

  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 4), 'utf-8');
  console.log(`[자동 갱신 완료] 제 ${newDraw.round}회: [${newDraw.numbers.join(', ')}] + 보너스 ${newDraw.bonus}`);
  console.log('==================================================');
}

run();
