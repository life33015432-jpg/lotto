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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
      }
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function run() {
  console.log('==================================================');
  console.log('[작업 시작] 로또 회차 자동 수집 및 JSON 갱신');
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
  const targetRound = latestRecordedRound + 1;

  console.log(`[정보] 현재 저장된 최신 회차: ${latestRecordedRound}회`);
  console.log(`[정보] 동행복권 조회 시도 대상 회차: ${targetRound}회`);

  const apiUrl = `https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=${targetRound}`;
  console.log(`[요청 URL] ${apiUrl}`);

  let res;
  try {
    res = await fetchWithTimeout(apiUrl, 10000);
    console.log(`[응답 상태] HTTP ${res.status} ${res.statusText}`);
  } catch (networkErr) {
    console.log(`[대기] 동행복권 통신 지연 (${networkErr.message}). 다음 예약 주기에 재시도합니다.`);
    return;
  }

  if (!res.ok) {
    console.log(`[대기] 동행복권 응답 코드 비정상 (HTTP ${res.status}). 다음 주기에 재시도합니다.`);
    return;
  }

  let data;
  try {
    data = await res.json();
    console.log(`[수신 데이터] ${JSON.stringify(data)}`);
  } catch (parseErr) {
    console.log(`[대기] JSON 파싱 불가 (점검 중 페이지 등). 다음 주기에 재시도합니다.`);
    return;
  }

  if (!data || data.returnValue !== 'success') {
    console.log(`[알림] 제 ${targetRound}회차 결과가 아직 공개되지 않았습니다. (returnValue: ${data ? data.returnValue : 'null'})`);
    return;
  }

  const newDraw = {
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

  history.unshift(newDraw);
  history.sort((a, b) => Number(b.round || 0) - Number(a.round || 0));

  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 4), 'utf-8');
  console.log(`[성공] 제 ${newDraw.round}회 당첨번호 반영 완료:`, newDraw.numbers, `+ 보너스 ${newDraw.bonus}`);
  console.log('==================================================');
}

run();
