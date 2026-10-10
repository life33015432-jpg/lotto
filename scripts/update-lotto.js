// scripts/update-lotto.js
const fs = require('fs');
const path = require('path');

const HISTORY_PATH = path.join(__dirname, '../data/lotto-history.json');
const HTML_PATH = path.join(__dirname, '../index.html');

async function fetchWithTimeout(url, timeoutMs = 9000, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// 1차: 동행복권 공식 데이터 채널 (해외 러너 IP 차단 방지 헤더 세팅)
async function fetchFromOfficialApi(round) {
  const url = `https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=${round}`;
  try {
    const res = await fetchWithTimeout(url, 7000, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Referer': 'https://www.dhlottery.co.kr/'
      }
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.returnValue === 'success') {
      const numbers = [
        data.drwtNo1, data.drwtNo2, data.drwtNo3,
        data.drwtNo4, data.drwtNo5, data.drwtNo6
      ].map(Number).sort((a, b) => a - b);
      const bonus = Number(data.bnusNo);
      if (numbers.length === 6 && bonus >= 1 && bonus <= 45) {
        return { round: Number(data.drwNo), numbers, bonus };
      }
    }
  } catch (e) {
    console.log(`[공식 API 조회 실패] 제 ${round}회:`, e.message);
  }
  return null;
}

// 2차: 네이버 모바일 검색 ("로또 최신당첨회차")
async function fetchFromNaver(round) {
  const query = encodeURIComponent(`로또 최신당첨회차 ${round}회`);
  const url = `https://m.search.naver.com/search.naver?query=${query}`;
  try {
    const res = await fetchWithTimeout(url, 8000, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
        'Accept-Language': 'ko-KR,ko;q=0.9'
      }
    });
    if (!res.ok) return null;
    const html = await res.text();

    const roundRegex = new RegExp(`(?:제\\s*)?${round}\\s*회`);
    if (!roundRegex.test(html)) return null;

    const spanRegex = /<span class="(?:num|ball)[^>]*>(\d+)<\/span>/g;
    const allNums = [];
    let match;
    while ((match = spanRegex.exec(html)) !== null) {
      allNums.push(Number(match[1]));
    }

    if (allNums.length >= 7) {
      const numbers = allNums.slice(0, 6).sort((a, b) => a - b);
      const bonus = Number(allNums[6]);
      if (numbers.every(n => n >= 1 && n <= 45) && bonus >= 1 && bonus <= 45) {
        return { round: Number(round), numbers, bonus };
      }
    }
  } catch (e) {
    console.log(`[네이버 조회 실패] 제 ${round}회:`, e.message);
  }
  return null;
}

// 3차: 구글 검색 보조 fallback
async function fetchFromGoogle(round) {
  const query = encodeURIComponent(`로또 최신당첨회차 ${round}회 당첨번호`);
  const url = `https://www.google.com/search?q=${query}&hl=ko`;
  try {
    const res = await fetchWithTimeout(url, 8000, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
      }
    });
    if (!res.ok) return null;
    const html = await res.text();

    if (!html.includes(`${round}회`)) return null;

    const candidateMatches = html.match(/\b\d{1,2}\s*,\s*\d{1,2}\s*,\s*\d{1,2}\s*,\s*\d{1,2}\s*,\s*\d{1,2}\s*,\s*\d{1,2}\b/);
    if (candidateMatches) {
      const nums = candidateMatches[0].split(',').map(n => Number(n.trim())).sort((a, b) => a - b);
      const bonusMatch = html.match(/보너스\D{0,10}(\d{1,2})/);
      const bonus = bonusMatch ? Number(bonusMatch[1]) : null;
      if (nums.length === 6 && bonus && nums.every(n => n >= 1 && n <= 45)) {
        return { round: Number(round), numbers, bonus };
      }
    }
  } catch (e) {
    console.log(`[구글 조회 실패] 제 ${round}회:`, e.message);
  }
  return null;
}

// index.html의 FALLBACK_HISTORY 및 기본 STATE 회차 자동 갱신
function updateIndexHtml(latestItem) {
  if (!fs.existsSync(HTML_PATH)) return;
  let html = fs.readFileSync(HTML_PATH, 'utf-8');

  const fallbackRegex = /const\s+FALLBACK_HISTORY\s*=\s*\[[\s\S]*?\];/;
  const newFallbackCode = `const FALLBACK_HISTORY = [\n      ${JSON.stringify(latestItem)}\n    ];`;
  html = html.replace(fallbackRegex, newFallbackCode);

  html = html.replace(/targetRound:\s*\d+/, `targetRound: ${latestItem.round + 1}`);
  html = html.replace(/prevRound:\s*\d+/, `prevRound: ${latestItem.round}`);

  fs.writeFileSync(HTML_PATH, html, 'utf-8');
  console.log(`[HTML 갱신] index.html 최신 회차가 제 ${latestItem.round}회로 자동 동기화되었습니다.`);
}

async function run() {
  console.log('==================================================');
  console.log('[작업 시작] 로또 최신당첨회차 검증 및 자동 수집');
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

  console.log(`[현재 DB 최신회차]: 제 ${latestRecordedRound}회`);

  while (true) {
    console.log(`\n[확인] 제 ${targetRound}회 (+1 회차) 데이터 조회 시도...`);
    
    // 1차 공식 채널 -> 2차 네이버 모바일 -> 3차 구글 검색 순차 확인
    let drawData = await fetchFromOfficialApi(targetRound);

    if (!drawData) {
      console.log(`[알림] 공식 API 미확인. 네이버 '로또 최신당첨회차' 검색 시도...`);
      drawData = await fetchFromNaver(targetRound);
    }

    if (!drawData) {
      console.log(`[알림] 네이버 미확인. 구글 검색 시도...`);
      drawData = await fetchFromGoogle(targetRound);
    }

    if (drawData && drawData.numbers && drawData.numbers.length === 6) {
      history.unshift(drawData);
      hasNewData = true;
      console.log(`[성공] 제 ${drawData.round}회 당첨번호 확보:`, drawData.numbers, `+ 보너스 ${drawData.bonus}`);
      targetRound++;
      await new Promise(r => setTimeout(r, 1000));
    } else {
      console.log(`[종료] 제 ${targetRound}회 결과는 아직 추첨 전이거나 데이터가 없습니다.`);
      break;
    }
  }

  if (hasNewData) {
    history.sort((a, b) => Number(b.round || 0) - Number(a.round || 0));
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 4), 'utf-8');
    console.log(`[완료] lotto-history.json 업데이트 완료.`);
    updateIndexHtml(history[0]);
  } else {
    console.log(`[완료] 이미 최신 상태입니다.`);
  }
  console.log('==================================================');
}

run();
