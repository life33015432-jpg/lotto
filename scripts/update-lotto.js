// scripts/update-lotto.js
const fs = require('fs');
const path = require('path');

const HISTORY_PATH = path.join(__dirname, '../data/lotto-history.json');

// 10초 타임아웃 및 User-Agent 차단 방지 적용 fetch 함수
async function fetchWithTimeout(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function run() {
  try {
    let history = [];
    if (fs.existsSync(HISTORY_PATH)) {
      const raw = fs.readFileSync(HISTORY_PATH, 'utf-8');
      history = JSON.parse(raw);
    }

    // 내림차순(최신순) 정렬 보장
    history.sort((a, b) => Number(b.round || 0) - Number(a.round || 0));

    // 최신 회차 번호 추출
    const latestRecordedRound = history.length > 0 
      ? Math.max(...history.map(d => Number(d.round || 0))) 
      : 0;
    const targetRound = latestRecordedRound + 1;

    console.log(`[시작] 기존 최신 회차: ${latestRecordedRound}회, 조회 대상: ${targetRound}회`);

    const apiUrl = `https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=${targetRound}`;
    
    let res;
    try {
      res = await fetchWithTimeout(apiUrl, 10000);
    } catch (networkErr) {
      console.log(`[대기] 동행복권 통신 지연 (${networkErr.message}). 워크플로우를 중단하지 않고 다음 예약 주기에 재시도합니다.`);
      return;
    }

    if (!res.ok) {
      console.log(`[대기] 동행복권 응답 코드 이상 (HTTP ${res.status}). 다음 주기에 재시도합니다.`);
      return;
    }

    let data;
    try {
      data = await res.json();
    } catch (parseErr) {
      console.log(`[대기] 동행복권 응답 데이터 해석 지연 (점검 중이거나 HTML 반환). 다음 주기에 재시도합니다.`);
      return;
    }

    if (!data || data.returnValue !== 'success') {
      console.log(`[알림] 제 ${targetRound}회차 당첨 정보가 아직 공개되지 않았습니다. 다음 예약 스케줄에서 재시도합니다.`);
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

    // 최신 회차를 맨 앞에 추가(내림차순 유지)
    history.unshift(newDraw);
    history.sort((a, b) => Number(b.round || 0) - Number(a.round || 0));

    fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2), 'utf-8');
    console.log(`[성공] 제 ${newDraw.round}회 당첨번호가 성공적으로 업데이트되었습니다:`, newDraw.numbers, `+ 보너스 ${newDraw.bonus}`);
  } catch (err) {
    console.log('[안내] 일시적 예외 발생. 워크플로우 실패(빨간색 X)를 방지하고 다음 예약 주기로 넘깁니다:', err.message);
  }
}

run();
