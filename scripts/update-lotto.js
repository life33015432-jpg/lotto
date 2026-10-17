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

// 1차: 네이버 모바일 검색 페이지 직접 스크래핑
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

    if (!res.ok) {
      console.log(`  [네이버 검색] HTTP 응답 코드: ${res.status}`);
      return null;
    }

    const html = await res.text();

    const roundCheck = new RegExp(`(?:제\\s*)?${round}\\s*회`);
    if (!roundCheck.test(html)) {
      console.log(`  [네이버 검색] HTML 내 제 ${round}회 문구 미확인`);
      return null;
    }

    const ballRegex = /<span class="(?:btn_num|num|ball)[^>]*>(\d{1,2})<\/span>/g;
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
      console.log(`  [네이버 검색] ${round}회 파싱 완료:`, numbers, `+ 보너스 ${bonus}`);
      return { round: Number(round), numbers, bonus };
    }
  } catch (e) {
    console.log(`  [네이버 검색 예외]: ${e.message}`);
  }
  return null;
}

// 2차: 다음(Daum) 모바일 검색 결과 스크래핑
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

    if (!res.ok) {
      console.log(`  [다음 검색] HTTP 응답 코드: ${res.status}`);
      return null;
    }

    const html = await res.text();

    if (!html.includes(`${round}회`)) {
      console.log(`  [다음 검색] HTML 내 제 ${round}회 미포함`);
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
      console.log(`  [다음 검색] ${round}회 파싱 완료:`, numbers, `+ 보너스 ${bonus}`);
      return { round: Number(round), numbers, bonus };
    }
  } catch (e) {
    console.log(`  [다음 검색 예외]: ${e.message}`);
  }
  return null;
}

// 3차: 네이버 모바일 내부 API (스마트블록 연동)
async function fetchFromNaverInnerApi(round) {
  const url = `https://m.search.naver.com/p/csearch/content/qapirender.nhn?where=m&pkid=288&key=LottoResult&q=${round}회로또`;
  try {
    const res = await fetchWithTimeout(url, 7000, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Referer': 'https://m.search.naver.com/'
      }
    });
    if (!res.ok) return null;
    const data = await res.json();

    if (data && data.html) {
      const ballRegex = /<span class="(?:btn_num|num|ball)[^>]*>(\d{1,2})<\/span>/g;
      const nums = [];
      let match;
      while ((match = ballRegex.exec(data.html)) !== null) {
        const val = Number(match[1]);
        if (val >= 1 && val <= 45) nums.push(val);
      }
      if (nums.length >= 7) {
        const numbers = nums.slice(0, 6).sort((a, b) => a - b);
        const bonus = nums[6];
        console.log(`  [네이버 내부 API] ${round}회 추출 완료:`, numbers, `+ 보너스 ${bonus}`);
        return { round: Number(round), numbers, bonus };
      }
    }
  } catch (e) {
    console.log(`  [네이버 내부 API 예외]: ${e.message}`);
  }
  return null;
}

async function run() {
  console.log('==================================================');
  console.log('[작업 시작] 로또 포털 검색 직통 자동 수집');
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

    // 1차: 네이버 모바일 검색 스크래핑
    let drawData = await fetchFromNaverSearch(targetRound);

    // 2차: 네이버 실패 시 다음(Daum) 모바일 검색
    if (!drawData) {
      console.log(`  -> 2차 다음(Daum) 검색 스크래핑 시도`);
      drawData = await fetchFromDaumSearch(targetRound);
    }

    // 3차: 다음 실패 시 네이버 내부 API
    if (!drawData) {
      console.log(`  -> 3차 네이버 내부 API 시도`);
      drawData = await fetchFromNaverInnerApi(targetRound);
    }

    if (drawData && drawData.numbers && drawData.numbers.length === 6) {
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
      console.log(`[종료] 제 ${targetRound}회 데이터 수집 완료 또는 미발표 상태입니다.`);
      break;
    }
  }

  if (hasNewData) {
    history.sort((a, b) => Number(b.round || 0) - Number(a.round || 0));
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2), 'utf-8');
    console.log(`[완료] lotto-history.json 파일이 성공적으로 갱신되었습니다.`);
  } else {
    console.log(`[완료] 추가 변경 데이터가 없습니다.`);
  }
  console.log('==================================================');
}

run();
