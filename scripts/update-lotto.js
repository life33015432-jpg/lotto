// scripts/update-lotto.js
const fs = require('fs');
const path = require('path');

const HISTORY_PATH = path.join(__dirname, '../data/lotto-history.json');

async function fetchWithTimeout(url, timeoutMs = 9000, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// 1차: 네이버 모바일 검색 (회차 카드 정밀 일치 검증)
async function fetchFromNaverSearch(round) {
  const query = encodeURIComponent(`로또 ${round}회 당첨번호`);
  const url = `https://m.search.naver.com/search.naver?query=${query}`;
  try {
    const res = await fetchWithTimeout(url, 8000, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9',
        'Referer': 'https://m.naver.com/'
      }
    });

    if (!res.ok) return null;
    const html = await res.text();

    // 네이버 로또 당첨결과 영역 블록 추출
    const blockMatch = html.match(/<div class="api_subject_bx"[^>]*>[\s\S]*?로또[\s\S]*?<\/div>/);
    const searchTarget = blockMatch ? blockMatch[0] : html;

    // "제 1246회 당첨결과" 형태의 헤더 텍스트와 정확히 일치하는지 검증
    const exactRoundPattern = new RegExp(`(?:<strong>|<em>|<span>|\\b)제?\\s*${round}\\s*회\\s*(?:당첨|추첨)?`, 'i');
    if (!exactRoundPattern.test(searchTarget)) {
      console.log(`  [네이버 검색] 제 ${round}회 공식 결과 영역 미확인 (미추첨 상태)`);
      return null;
    }

    const ballRegex = /<span class="(?:btn_num|num|ball)[^>]*>(\d{1,2})<\/span>/g;
    const nums = [];
    let match;
    while ((match = ballRegex.exec(searchTarget)) !== null) {
      const val = Number(match[1]);
      if (val >= 1 && val <= 45) {
        nums.push(val);
      }
    }

    if (nums.length >= 7) {
      const numbers = nums.slice(0, 6).sort((a, b) => a - b);
      const bonus = nums[6];
      return { round: Number(round), numbers, bonus };
    }
  } catch (e) {
    console.log(`  [네이버 검색 예외]: ${e.message}`);
  }
  return null;
}

// 2차: 다음(Daum) 모바일 검색
async function fetchFromDaumSearch(round) {
  const query = encodeURIComponent(`로또 ${round}회 당첨번호`);
  const url = `https://m.search.daum.net/search?w=tot&q=${query}`;
  try {
    const res = await fetchWithTimeout(url, 8000, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
        'Accept-Language': 'ko-KR,ko;q=0.9',
        'Referer': 'https://m.daum.net/'
      }
    });

    if (!res.ok) return null;
    const html = await res.text();

    // 다음 결과 타이틀 영역에서 정확한 회차 일치 검증
    const daumPattern = new RegExp(`<strong>${round}회<\/strong>|<span>${round}회 당첨번호<\/span>`);
    if (!daumPattern.test(html)) {
      return null;
    }

    const ballRegex = /<(?:span|em) class="(?:img_ball\d|ball|num)[^>]*>(\d{1,2})<\/(?:span|em)>/g;
    const nums = [];
    let match;
    while ((match = ballRegex.exec(html)) !== null) {
      const val = Number(match[1]);
      if (val >= 1 && val <= 45) {
        nums.push(val);
      }
    }

    if (nums.length >= 7) {
      const numbers = nums.slice(0, 6).sort((a, b) => a - b);
      const bonus = nums[6];
      return { round: Number(round), numbers, bonus };
    }
  } catch (e) {
    // 실패 시 통과
  }
  return null;
}

async function run() {
  console.log('==================================================');
  console.log('[작업 시작] 로또 포털 검색 직통 자동 수집 (중복 검증 강화)');
  console.log('==================================================');

  let history = [];
  if (fs.existsSync(HISTORY_PATH)) {
    try {
      history = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8'));
    } catch (e) {
      history = [];
    }
  }

  // 회차 번호 기준 내림차순 정렬
  history.sort((a, b) => Number(b.round || 0) - Number(a.round || 0));
  
  // 잘못 들어간 1247회가 있다면(1246회와 번호가 동일한 경우) 자동 정리
  if (history.length >= 2 && history[0].numbers.join(',') === history[1].numbers.join(',')) {
    console.log(`[경고] 동일 번호 중복 저장 감지! 잘못 저장된 제 ${history[0].round}회를 제거합니다.`);
    history.shift();
  }

  const latestRecordedRound = history.length > 0 ? Number(history[0].round || 0) : 0;
  let targetRound = latestRecordedRound + 1;
  let hasNewData = false;

  console.log(`[현재 DB 최신회차]: 제 ${latestRecordedRound}회`);

  while (true) {
    console.log(`\n[확인] 제 ${targetRound}회 데이터 수집 시도...`);

    let drawData = await fetchFromNaverSearch(targetRound);

    if (!drawData) {
      console.log(`  -> 2차 다음(Daum) 검색 스크래핑 시도`);
      drawData = await fetchFromDaumSearch(targetRound);
    }

    if (drawData && drawData.numbers && drawData.numbers.length === 6) {
      // 직전 최신 회차와 번호가 완전히 같으면 포털이 최신회차를 보여준 것이므로 중단
      const previousNumbers = history.length > 0 ? history[0].numbers.join(',') : '';
      const currentNumbers = drawData.numbers.join(',');

      if (previousNumbers === currentNumbers) {
        console.log(`[차단] 제 ${targetRound}회 수집 번호가 직전 회차(${history[0].round}회) 번호와 완전히 일치합니다.`);
        console.log(`  -> 포털이 아직 미추첨 회차 대신 지난 회차 번호를 반환한 것이므로 수집을 종료합니다.`);
        break;
      }

      const existsIndex = history.findIndex(item => Number(item.round) === Number(drawData.round));
      if (existsIndex >= 0) {
        history[existsIndex] = drawData;
      } else {
        history.unshift(drawData);
      }

      hasNewData = true;
      console.log(`[성공] 제 ${drawData.round}회 당첨번호 확보 완료:`, drawData.numbers, `+ 보너스 ${drawData.bonus}`);
      targetRound++;
      await new Promise(r => setTimeout(r, 1200));
    } else {
      console.log(`[종료] 제 ${targetRound}회는 아직 미추첨 상태이거나 데이터를 가져올 수 없습니다.`);
      break;
    }
  }

  if (hasNewData) {
    history.sort((a, b) => Number(b.round || 0) - Number(a.round || 0));
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2), 'utf-8');
    console.log(`[완료] lotto-history.json 파일이 정상적으로 정리 및 갱신되었습니다.`);
  } else {
    console.log(`[완료] 추가 변경 데이터가 없습니다.`);
  }
  console.log('==================================================');
}

run();
