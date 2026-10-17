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

// 1번 검증 채널: 네이버 모바일 검색 스크래핑
async function getNumbersFromNaver(round) {
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

    const ballRegex = /<span class="(?:btn_num|num|ball)[^>]*>(\d{1,2})<\/span>/g;
    const nums = [];
    let match;
    while ((match = ballRegex.exec(html)) !== null) {
      const val = Number(match[1]);
      if (val >= 1 && val <= 45) nums.push(val);
    }

    if (nums.length >= 7) {
      const numbers = nums.slice(0, 6).sort((a, b) => a - b);
      const bonus = nums[6];
      return { source: '네이버', round: Number(round), numbers, bonus };
    }
  } catch (e) {
    console.log(`  [네이버 수집 에러]: ${e.message}`);
  }
  return null;
}

// 2번 검증 채널: 다음(Daum) 모바일 검색 스크래핑
async function getNumbersFromDaum(round) {
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

    const ballRegex = /<(?:span|em) class="(?:img_ball\d|ball|num)[^>]*>(\d{1,2})<\/(?:span|em)>/g;
    const nums = [];
    let match;
    while ((match = ballRegex.exec(html)) !== null) {
      const val = Number(match[1]);
      if (val >= 1 && val <= 45) nums.push(val);
    }

    if (nums.length >= 7) {
      const numbers = nums.slice(0, 6).sort((a, b) => a - b);
      const bonus = nums[6];
      return { source: '다음', round: Number(round), numbers, bonus };
    }
  } catch (e) {
    console.log(`  [다음 수집 에러]: ${e.message}`);
  }
  return null;
}

// 3번 검증 채널: 동행복권 모바일 공식 결과 페이지
async function getNumbersFromOfficialMobile(round) {
  const url = `https://m.dhlottery.co.kr/gameResult.do?method=byWin&drwNo=${round}`;
  try {
    const res = await fetchWithTimeout(url, 8000, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
        'Referer': 'https://m.dhlottery.co.kr/'
      }
    });
    if (!res.ok) return null;
    const html = await res.text();

    const ballRegex = /<span class="ball_645[^"]*">(\d{1,2})<\/span>/g;
    const nums = [];
    let match;
    while ((match = ballRegex.exec(html)) !== null) {
      const val = Number(match[1]);
      if (val >= 1 && val <= 45) nums.push(val);
    }

    if (nums.length >= 7) {
      const numbers = nums.slice(0, 6).sort((a, b) => a - b);
      const bonus = nums[6];
      return { source: '동행복권모바일', round: Number(round), numbers, bonus };
    }
  } catch (e) {
    console.log(`  [동행복권모바일 수집 에러]: ${e.message}`);
  }
  return null;
}

// 상호 검증 실행 함수 (최소 2개 이상 채널의 7개 번호 일치 검사)
async function verifyAndFetchDraw(round) {
  console.log(`\n[상호 검증 시작] 제 ${round}회 다중 채널 동시 조회 중...`);

  // 3개 소스 병렬 수집
  const [resNaver, resDaum, resOfficial] = await Promise.all([
    getNumbersFromNaver(round),
    getNumbersFromDaum(round),
    getNumbersFromOfficialMobile(round)
  ]);

  const candidates = [resNaver, resDaum, resOfficial].filter(Boolean);
  console.log(`  -> 유효 응답 소스 수: ${candidates.length}개`);

  candidates.forEach(c => {
    console.log(`    - [${c.source}] 번호: [${c.numbers.join(', ')}] + 보너스 ${c.bonus}`);
  });

  if (candidates.length < 2) {
    console.log(`  [검증 보류] 상호 대조를 위한 최소 응답 채널(2개) 부족`);
    return null;
  }

  // 후보군 간 7개 번호 상호 대조
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];

      const numbersMatch = a.numbers.join(',') === b.numbers.join(',');
      const bonusMatch = a.bonus === b.bonus;

      if (numbersMatch && bonusMatch) {
        console.log(`  [상호 검증 통과!] ${a.source} 채널과 ${b.source} 채널 데이터가 100% 일치합니다.`);
        return {
          round: Number(round),
          numbers: a.numbers,
          bonus: a.bonus
        };
      }
    }
  }

  console.log(`  [검증 실패] 채널 간 당첨 번호 불일치 발생 (아직 미추첨이거나 포털 간 데이터 미동기화)`);
  return null;
}

async function run() {
  console.log('==================================================');
  console.log('[작업 시작] 로또 당첨번호 다중 채널 상호 검증 파이프라인');
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

  // 잘못 저장되었던 중복 회차 정리 방어 코드
  if (history.length >= 2 && history[0].numbers.join(',') === history[1].numbers.join(',')) {
    console.log(`[정리] 이전 중복 기록 감지: 제 ${history[0].round}회 정리`);
    history.shift();
  }

  const latestRecordedRound = history.length > 0 ? Number(history[0].round || 0) : 0;
  let targetRound = latestRecordedRound + 1;
  let hasNewData = false;

  console.log(`[현재 DB 최신회차]: 제 ${latestRecordedRound}회`);

  while (true) {
    const verifiedData = await verifyAndFetchDraw(targetRound);

    if (verifiedData) {
      // 직전 회차와 동일 번호인지 최종 체크 (네이버/다음이 둘 다 지난주 번호를 띄우고 있을 때의 방어책)
      const prevNumbers = history.length > 0 ? history[0].numbers.join(',') : '';
      if (prevNumbers === verifiedData.numbers.join(',')) {
        console.log(`[차단] 검증 통과된 번호가 직전 회차(${history[0].round}회) 번호와 동일합니다. 추첨 전 상태로 간주하고 종료합니다.`);
        break;
      }

      const existsIndex = history.findIndex(item => Number(item.round) === Number(verifiedData.round));
      if (existsIndex >= 0) {
        history[existsIndex] = verifiedData;
      } else {
        history.unshift(verifiedData);
      }

      hasNewData = true;
      console.log(`[최종 확정] 제 ${verifiedData.round}회 DB 반영 완료:`, verifiedData.numbers, `+ 보너스 ${verifiedData.bonus}`);
      targetRound++;
      await new Promise(r => setTimeout(r, 1500));
    } else {
      console.log(`[종료] 제 ${targetRound}회는 검증된 데이터가 없으므로 수집 작업을 마칩니다.`);
      break;
    }
  }

  if (hasNewData) {
    history.sort((a, b) => Number(b.round || 0) - Number(a.round || 0));
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2), 'utf-8');
    console.log(`[완료] lotto-history.json 파일이 정상적으로 갱신되었습니다.`);
  } else {
    console.log(`[완료] 추가 변경 데이터가 없습니다.`);
  }
  console.log('==================================================');
}

run();
