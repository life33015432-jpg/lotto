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

// 1차: 동행복권 공식 API
async function fetchFromOfficial(round) {
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
    // 해외 IP 차단 시 무시하고 다음 단계로 진행
  }
  return null;
}

// 2차: 해외 IP 차단 우회 프록시 (allorigins 프록시 경유 동행복권 API)
async function fetchFromProxyOfficial(round) {
  const target = encodeURIComponent(`https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=${round}`);
  const url = `https://api.allorigins.win/raw?url=${target}`;
  try {
    const res = await fetchWithTimeout(url, 9000);
    if (!res.ok) return null;
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
    // 프록시 지연 또는 오류 시 폴백 이동
  }
  return null;
}

// 3차: 공공 포털 / 오픈 API 백업 (한국 로또 데이터 미러 채널)
async function fetchFromOpenApi(round) {
  const url = `https://api.allorigins.win/get?url=${encodeURIComponent(`https://search.daum.net/search?w=tot&q=${round}회로또`)}`;
  try {
    const res = await fetchWithTimeout(url, 9000);
    if (!res.ok) return null;
    const json = await res.json();
    const html = json.contents;

    if (!html || !html.includes(`${round}회`)) return null;

    // 다음/카카오 검색 결과 로또 공 번호 패턴 추출
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
    // 무시
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

    // 1차: 공식 직통 -> 2차: 프록시 경유 공식 -> 3차: 포털 미러
    let drawData = await fetchFromOfficial(targetRound);

    if (!drawData) {
      console.log(`[알림] 1차 공식 직통 실패 (IP 제한 가능성). 2차 프록시 우회 시도...`);
      drawData = await fetchFromProxyOfficial(targetRound);
    }

    if (!drawData) {
      console.log(`[알림] 2차 프록시 실패. 3차 포털 오픈 채널 확인 시도...`);
      drawData = await fetchFromOpenApi(targetRound);
    }

    if (drawData && drawData.numbers && drawData.numbers.length === 6) {
      // 기존에 동일 회차가 있으면 교체, 없으면 추가
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
      console.log(`[종료] 제 ${targetRound}회는 아직 미추첨 상태이거나 갱신 데이터가 없습니다.`);
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
