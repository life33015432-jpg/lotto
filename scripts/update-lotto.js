// scripts/update-lotto.js
const fs = require('fs');
const path = require('path');

const HISTORY_PATH = path.join(__dirname, '../data/lotto-history.json');

async function fetchWithTimeout(url, timeoutMs = 8000, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// 1차: 동행복권 공식 JSON API 직통
async function fetchOfficialDirect(round) {
  const url = `https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=${round}`;
  try {
    const res = await fetchWithTimeout(url, 5000, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Referer': 'https://www.dhlottery.co.kr/'
      }
    });
    if (!res.ok) {
      console.log(`  [1차 직통 실패] HTTP 상태 코드: ${res.status}`);
      return null;
    }
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
    } else {
      console.log(`  [1차 직통 응답 실패] returnValue: ${data?.returnValue}`);
    }
  } catch (e) {
    console.log(`  [1차 직통 예외]: ${e.message}`);
  }
  return null;
}

// 2차: CodeTabs 프록시 경유 동행복권 API
async function fetchCodeTabs(round) {
  const target = encodeURIComponent(`https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=${round}`);
  const url = `https://api.codetabs.com/v1/proxy?quest=${target}`;
  try {
    const res = await fetchWithTimeout(url, 7000);
    if (!res.ok) {
      console.log(`  [2차 CodeTabs 실패] HTTP 상태 코드: ${res.status}`);
      return null;
    }
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
    console.log(`  [2차 CodeTabs 예외]: ${e.message}`);
  }
  return null;
}

// 3차: AllOrigins 프록시 경유 동행복권 API
async function fetchAllOrigins(round) {
  const target = encodeURIComponent(`https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=${round}`);
  const url = `https://api.allorigins.win/raw?url=${target}`;
  try {
    const res = await fetchWithTimeout(url, 8000);
    if (!res.ok) {
      console.log(`  [3차 AllOrigins 실패] HTTP 상태 코드: ${res.status}`);
      return null;
    }
    const text = await res.text();
    const data = JSON.parse(text);
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
    console.log(`  [3차 AllOrigins 예외]: ${e.message}`);
  }
  return null;
}

// 4차: 다음 포털 모바일 검색 결과 파싱
async function fetchDaumSearch(round) {
  const target = encodeURIComponent(`https://m.search.daum.net/search?w=tot&q=${round}회로또`);
  const url = `https://api.codetabs.com/v1/proxy?quest=${target}`;
  try {
    const res = await fetchWithTimeout(url, 8000);
    if (!res.ok) {
      console.log(`  [4차 Daum 포털 실패] HTTP 상태 코드: ${res.status}`);
      return null;
    }
    const html = await res.text();

    if (!html.includes(`${round}회`)) {
      console.log(`  [4차 Daum 포털 실패] ${round}회 키워드 미포함`);
      return null;
    }

    const ballRegex = /<span class="(?:img_ball\d|ball|num)[^>]*>(\d{1,2})<\/span>/g;
    const matches = [];
    let m;
    while ((m = ballRegex.exec(html)) !== null) {
      matches.push(Number(m[1]));
    }

    if (matches.length >= 7) {
      const numbers = matches.slice(0, 6).sort((a, b) => a - b);
      const bonus = matches[6];
      if (numbers.every(n => n >= 1 && n <= 45) && bonus >= 1 && bonus <= 45) {
        return { round: Number(round), numbers, bonus };
      }
    }
  } catch (e) {
    console.log(`  [4차 Daum 포털 예외]: ${e.message}`);
  }
  return null;
}

async function run() {
  console.log('==================================================');
  console.log('[작업 시작] 로또 최신당첨회차 검증 및 자동 수집 v2');
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
    console.log(`\n[확인] 제 ${targetRound}회 데이터 수집 시도...`);

    let drawData = await fetchOfficialDirect(targetRound);

    if (!drawData) {
      console.log(`  -> 2차 CodeTabs 프록시 시도`);
      drawData = await fetchCodeTabs(targetRound);
    }

    if (!drawData) {
      console.log(`  -> 3차 AllOrigins 프록시 시도`);
      drawData = await fetchAllOrigins(targetRound);
    }

    if (!drawData) {
      console.log(`  -> 4차 다음 검색 결과 시도`);
      drawData = await fetchDaumSearch(targetRound);
    }

    if (drawData && drawData.numbers && drawData.numbers.length === 6) {
      const existsIndex = history.findIndex(item => Number(item.round) === Number(drawData.round));
      if (existsIndex >= 0) {
        history[existsIndex] = drawData;
      } else {
        history.unshift(drawData);
      }

      hasNewData = true;
      console.log(`[성공] 제 ${drawData.round}회 확보 완료:`, drawData.numbers, `+ 보너스 ${drawData.bonus}`);
      targetRound++;
      await new Promise(r => setTimeout(r, 1200));
    } else {
      console.log(`[종료] 제 ${targetRound}회 데이터 수집 불가 (미추첨 상태이거나 모든 채널 응답 없음)`);
      break;
    }
  }

  if (hasNewData) {
    history.sort((a, b) => Number(b.round || 0) - Number(a.round || 0));
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2), 'utf-8');
    console.log(`[완료] lotto-history.json 파일이 정상적으로 갱신되었습니다.`);
  } else {
    console.log(`[완료] 추가 변경 사항이 없습니다.`);
  }
  console.log('==================================================');
}

run();
