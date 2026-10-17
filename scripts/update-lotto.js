// scripts/update-lotto.js
const fs = require('fs');
const path = require('path');

const HISTORY_PATH = path.join(__dirname, '../data/lotto-history.json');

async function fetchWithTimeout(url, timeoutMs = 10000, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// 1차: 동행복권 공식 API 직통
async function fetchFromOfficialApi(round) {
  const url = `https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=${round}`;
  try {
    const res = await fetchWithTimeout(url, 6000, {
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
    // 해외 IP 차단 시 무시
  }
  return null;
}

// 2차: CodeTabs CORS 프록시 경유 동행복권 API (안정적인 해외 IP 우회)
async function fetchFromCodeTabsProxy(round) {
  const target = encodeURIComponent(`https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=${round}`);
  const url = `https://api.codetabs.com/v1/proxy?quest=${target}`;
  try {
    const res = await fetchWithTimeout(url, 9000);
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
    // 실패 시 다음 폴백으로 이동
  }
  return null;
}

// 3차: 동행복권 모바일 결과 페이지 스크래핑
async function fetchFromOfficialMobile(round) {
  const target = encodeURIComponent(`https://m.dhlottery.co.kr/gameResult.do?method=byWin&drwNo=${round}`);
  const url = `https://api.codetabs.com/v1/proxy?quest=${target}`;
  try {
    const res = await fetchWithTimeout(url, 9000);
    if (!res.ok) return null;
    const html = await res.text();

    if (!html.includes(`${round}회`)) return null;

    // ball_645 클래스 내 번호 추출
    const ballRegex = /<span class="ball_645[^"]*">(\d{1,2})<\/span>/g;
    const numbers = [];
    let match;
    while ((match = ballRegex.exec(html)) !== null) {
      numbers.push(Number(match[1]));
    }

    if (numbers.length >= 7) {
      const mainNumbers = numbers.slice(0, 6).sort((a, b) => a - b);
      const bonus = numbers[6];
      if (mainNumbers.every(n => n >= 1 && n <= 45) && bonus >= 1 && bonus <= 45) {
        return { round: Number(round), numbers: mainNumbers, bonus };
      }
    }
  } catch (e) {
    // 실패 시 통과
  }
  return null;
}

// 4차: 다음 포털 검색 결과 추출
async function fetchFromDaumSearch(round) {
  const target = encodeURIComponent(`https://search.daum.net/search?w=tot&q=${round}회로또`);
  const url = `https://api.allorigins.win/raw?url=${target}`;
  try {
    const res = await fetchWithTimeout(url, 9000);
    if (!res.ok) return null;
    const html = await res.text();

    if (!html.includes(`${round}회`)) return null;

    const regex = /<span class="(?:img_ball\d|ball|num)[^>]*>(\d{1,2})<\/span>/g;
    const matches = [];
    let m;
    while ((m = regex.exec(html)) !== null) {
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
    // 실패 시 통과
  }
  return null;
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
    console.log(`\n[확인] 제 ${targetRound}회 데이터 수집 시도...`);

    // 1차: 공식 직통
    let drawData = await fetchFromOfficialApi(targetRound);

    // 2차: CodeTabs 프록시 공식 API
    if (!drawData) {
      console.log(`[알림] 1차 직통 차단/실패. 2차 CodeTabs 프록시 API 시도...`);
      drawData = await fetchFromCodeTabsProxy(targetRound);
    }

    // 3차: 모바일 공식 페이지 스크래핑
    if (!drawData) {
      console.log(`[알림] 2차 프록시 API 실패. 3차 동행복권 모바일 페이지 시도...`);
      drawData = await fetchFromOfficialMobile(targetRound);
    }

    // 4차: 포털 검색 미러
    if (!drawData) {
      console.log(`[알림] 3차 모바일 실패. 4차 다음 포털 채널 시도...`);
      drawData = await fetchFromDaumSearch(targetRound);
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
      await new Promise(r => setTimeout(r, 1500));
    } else {
      console.log(`[종료] 제 ${targetRound}회는 아직 미추첨 상태이거나 데이터를 가져올 수 없습니다.`);
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
