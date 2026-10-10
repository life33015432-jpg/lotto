// scripts/update-lotto.js
const fs = require('fs');
const path = require('path');

const HISTORY_PATH = path.join(__dirname, '../data/lotto-history.json');
const HTML_PATH = path.join(__dirname, '../index.html');

async function fetchWithTimeout(url, timeoutMs = 8000, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// 1차: 네이버 모바일 검색 ("로또 토요일 당첨번호")
async function fetchFromNaver(round) {
  const query = encodeURIComponent(`로또 토요일 당첨번호 ${round}회`);
  const url = `https://m.search.naver.com/search.naver?query=${query}`;
  try {
    const res = await fetchWithTimeout(url, 8000, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });
    if (!res.ok) return null;
    const html = await res.text();

    const roundRegex = new RegExp(`(?:제\\s*)?${round}\\s*회`);
    if (!roundRegex.test(html)) return null;

    const spanRegex = /<span class="num[^>]*>(\d+)<\/span>/g;
    const allNums = [];
    let sm;
    while ((sm = spanRegex.exec(html)) !== null) {
      allNums.push(Number(sm[1]));
    }
    if (allNums.length >= 7) {
      const numbers = allNums.slice(0, 6).sort((a, b) => a - b);
      const bonus = Number(allNums[6]);
      if (numbers.every(n => n >= 1 && n <= 45) && bonus >= 1 && bonus <= 45) {
        return { round: Number(round), numbers, bonus };
      }
    }
  } catch (e) {
    console.log(`[네이버 조회 실패] ${round}회:`, e.message);
  }
  return null;
}

// 2차: 구글 검색 ("로또 토요일 당첨번호")
async function fetchFromGoogle(round) {
  const query = encodeURIComponent(`로또 토요일 당첨번호 ${round}회`);
  const url = `https://www.google.com/search?q=${query}&hl=ko`;
  try {
    const res = await fetchWithTimeout(url, 8000, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (!res.ok) return null;
    const html = await res.text();

    if (!html.includes(`${round}회`)) return null;

    const candidateMatches = html.match(/\b\d{1,2}\s*,\s*\d{1,2}\s*,\s*\d{1,2}\s*,\s*\d{1,2}\s*,\s*\d{1,2}\s*,\s*\d{1,2}\b/);
    if (candidateMatches) {
      const nums = candidateMatches[0].split(',').map(n => Number(n.trim())).sort((a,b) => a - b);
      const bonusMatch = html.match(/보너스\D{0,10}(\d{1,2})/);
      const bonus = bonusMatch ? Number(bonusMatch[1]) : null;
      if (nums.length === 6 && bonus) {
        return { round: Number(round), numbers: nums, bonus };
      }
    }
  } catch (e) {
    console.log(`[구글 조회 실패] ${round}회:`, e.message);
  }
  return null;
}

// 3차 보조: 공식 오픈 API fallback
async function fetchFromOfficialApi(round) {
  const url = `https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=${round}`;
  try {
    const res = await fetchWithTimeout(url, 6000, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.returnValue === 'success') {
      const numbers = [
        data.drwtNo1, data.drwtNo2, data.drwtNo3,
        data.drwtNo4, data.drwtNo5, data.drwtNo6
      ].map(Number).sort((a, b) => a - b);
      return {
        round: Number(data.drwNo),
        numbers,
        bonus: Number(data.bnusNo)
      };
    }
  } catch (e) {
    console.log(`[공식 API 조회 실패] ${round}회:`, e.message);
  }
  return null;
}

// index.html의 FALLBACK_HISTORY 및 기본 STATE 회차 자동 치환 함수
function updateIndexHtml(latestItem) {
  if (!fs.existsSync(HTML_PATH)) return;
  let html = fs.readFileSync(HTML_PATH, 'utf-8');

  // FALLBACK_HISTORY 배열 치환
  const fallbackRegex = /const\s+FALLBACK_HISTORY\s*=\s*\[[\s\S]*?\];/;
  const newFallbackCode = `const FALLBACK_HISTORY = [\n      ${JSON.stringify(latestItem)}\n    ];`;
  html = html.replace(fallbackRegex, newFallbackCode);

  // STATE 객체 내 targetRound, prevRound 치환
  html = html.replace(/targetRound:\s*\d+/, `targetRound: ${latestItem.round + 1}`);
  html = html.replace(/prevRound:\s*\d+/, `prevRound: ${latestItem.round}`);

  fs.writeFileSync(HTML_PATH, html, 'utf-8');
  console.log(`[HTML 갱신] index.html의 Fallback 및 기본 회차가 제 ${latestItem.round}회로 자동 갱신되었습니다.`);
}

async function run() {
  console.log('==================================================');
  console.log('[작업 시작] 로또 토요일 당첨번호 다중 채널 자동 수집');
  console.log('==================================================');

  let history = [];
  if (fs.existsSync(HISTORY_PATH)) {
    try {
      history = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8'));
    } catch (e) {
      history = [];
    }
  }

  history.sort((a, b) => Number(b.round || 0) - Number(a.round || 0));
  const latestRecordedRound = history.length > 0 ? Number(history[0].round || 0) : 0;
  let targetRound = latestRecordedRound + 1;
  let hasNewData = false;

  console.log(`[정보] 현재 저장된 최신 회차: ${latestRecordedRound}회`);

  while (true) {
    console.log(`\n[진행] 제 ${targetRound}회차 수집 시도...`);
    let drawData = await fetchFromNaver(targetRound);

    if (!drawData) {
      console.log(`[알림] 네이버 조회 실패. 구글 검색으로 2차 조회 시도...`);
      drawData = await fetchFromGoogle(targetRound);
    }

    if (!drawData) {
      console.log(`[알림] 구글 조회 실패. 공식 백업 API로 3차 조회 시도...`);
      drawData = await fetchFromOfficialApi(targetRound);
    }

    if (drawData && drawData.numbers && drawData.numbers.length === 6) {
      history.unshift(drawData);
      hasNewData = true;
      console.log(`[성공] 제 ${drawData.round}회 당첨번호 수집 완료:`, drawData.numbers, `+ 보너스 ${drawData.bonus}`);
      targetRound++;
      await new Promise(r => setTimeout(r, 1200));
    } else {
      console.log(`[종료] 제 ${targetRound}회차 결과를 확인할 수 없습니다.`);
      break;
    }
  }

  if (hasNewData) {
    history.sort((a, b) => Number(b.round || 0) - Number(a.round || 0));
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 4), 'utf-8');
    console.log(`[완료] lotto-history.json 업데이트 완료.`);

    // index.html 정적 파일 자동 수정
    updateIndexHtml(history[0]);
  } else {
    console.log(`[완료] 최신 회차가 이미 최신 상태입니다.`);
  }
  console.log('==================================================');
}

run();
