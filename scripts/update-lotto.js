// scripts/update-lotto.js
const fs = require('fs');
const path = require('path');

const HISTORY_PATH = path.join(__dirname, '../data/lotto-history.json');

// 수동 실행 지원: node scripts/update-lotto.js [회차] [번호1,2,3,4,5,6] [보너스]
const manualRound = process.argv[2];
const manualNumbers = process.argv[3];
const manualBonus = process.argv[4];

async function fetchWithTimeout(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9'
      }
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// 네이버 모바일 검색 HTML에서 로또 당첨번호 정규식 파싱
async function fetchLottoFromNaver(targetRound) {
  const url = `https://m.search.naver.com/search.naver?query=${encodeURIComponent(targetRound + '회 로또')}`;
  console.log(`[네이버 수집 요청] ${url}`);

  const res = await fetchWithTimeout(url, 10000);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const html = await res.text();

  // 1. 회차 검증
  if (!html.includes(`${targetRound}회`)) {
    console.log(`[알림] 네이버 검색 결과에 아직 ${targetRound}회차 정보가 반영되지 않았습니다.`);
    return null;
  }

  // 2. 당첨번호 6개 추출
  // 네이버 모바일 로또 마크업 내 당첨공 번호: <span class="ball ...">XX</span> 또는 <span class="num ...">XX</span>
  const ballRegex = /<span class="(?:ball|num)[^"]*">(\d{1,2})<\/span>/g;
  const matches = [];
  let m;

  while ((m = ballRegex.exec(html)) !== null) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 45) {
      matches.push(n);
    }
    if (matches.length >= 7) break; // 6개 번호 + 1개 보너스
  }

  // 만약 대체 패턴 클래스일 경우의 보조 파서
  if (matches.length < 7) {
    const fallbackRegex = /<span[^>]*class="[^"]*win_ball[^"]*"[^>]*>(\d{1,2})<\/span>/g;
    while ((m = fallbackRegex.exec(html)) !== null) {
      const n = Number(m[1]);
      if (n >= 1 && n <= 45) matches.push(n);
      if (matches.length >= 7) break;
    }
  }

  if (matches.length >= 7) {
    const mainNumbers = matches.slice(0, 6).sort((a, b) => a - b);
    const bonusNumber = matches[6];
    return {
      round: targetRound,
      numbers: mainNumbers,
      bonus: bonusNumber
    };
  }

  console.log('[알림] 번호 태그 파싱 실패. 네이버 마크업이 변경되었거나 아직 추첨 결과가 집계되지 않았습니다.');
  return null;
}

async function run() {
  console.log('==================================================');
  console.log('[작업 시작] 네이버 기반 로또 회차 자동 수집 및 JSON 갱신');
  console.log('==================================================');

  let history = [];
  if (fs.existsSync(HISTORY_PATH)) {
    const raw = fs.readFileSync(HISTORY_PATH, 'utf-8');
    history = JSON.parse(raw);
  }

  history.sort((a, b) => Number(b.round || 0) - Number(a.round || 0));

  // [A] 수동 인자가 전달된 경우 즉시 처리
  if (manualRound && manualNumbers && manualBonus) {
    const parsedRound = Number(manualRound);
    const parsedNums = manualNumbers.split(',').map(n => Number(n.trim())).sort((a, b) => a - b);
    const parsedBonus = Number(manualBonus);

    // 중복 여부 확인
    history = history.filter(item => Number(item.round) !== parsedRound);
    history.unshift({
      round: parsedRound,
      numbers: parsedNums,
      bonus: parsedBonus
    });
    history.sort((a, b) => Number(b.round || 0) - Number(a.round || 0));

    fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 4), 'utf-8');
    console.log(`[수동 반영 완료] 제 ${parsedRound}회:`, parsedNums, `+ 보너스 ${parsedBonus}`);
    console.log('==================================================');
    return;
  }

  // [B] 자동 수집: 최신 회차 + 1 조회
  const latestRecordedRound = history.length > 0 
    ? Math.max(...history.map(d => Number(d.round || 0))) 
    : 0;
  const targetRound = latestRecordedRound + 1;

  console.log(`[정보] 현재 저장된 최신 회차: ${latestRecordedRound}회`);
  console.log(`[정보] 네이버 조회 시도 대상 회차: ${targetRound}회`);

  let newDraw = null;
  try {
    newDraw = await fetchLottoFromNaver(targetRound);
  } catch (err) {
    console.log(`[대기] 네이버 통신 지연 (${err.message}). 다음 예약 주기에 재시도합니다.`);
    return;
  }

  if (!newDraw) {
    return;
  }

  // 기존 배열 맨 앞에 삽입 후 저장
  history.unshift(newDraw);
  history.sort((a, b) => Number(b.round || 0) - Number(a.round || 0));

  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 4), 'utf-8');
  console.log(`[성공] 제 ${newDraw.round}회 당첨번호 반영 완료:`, newDraw.numbers, `+ 보너스 ${newDraw.bonus}`);
  console.log('==================================================');
}

run();
