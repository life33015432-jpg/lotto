// scripts/update-lotto.js
const fs = require('fs');
const path = require('path');

const HISTORY_PATH = path.join(__dirname, '../data/lotto-history.json');

async function fetchWithTimeout(url, timeoutMs = 10000, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// [엔진 1] 동행복권 공식 API
async function fetchFromDhLottery(round) {
  const url = `https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=${round}`;
  try {
    const res = await fetchWithTimeout(url, 10000, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.returnValue === 'success') {
      return {
        round: Number(data.drwNo),
        numbers: [data.drwtNo1, data.drwtNo2, data.drwtNo3, data.drwtNo4, data.drwtNo5, data.drwtNo6].map(Number).sort((a,b)=>a-b),
        bonus: Number(data.bnusNo)
      };
    }
  } catch (e) {
    console.log(`[동행복권 API 오류] ${e.message}`);
  }
  return null;
}

// [엔진 2] 네이버 모바일 검색 파싱 (동행복권 차단 시 우회)
async function fetchFromNaver(round) {
  const url = `https://m.search.naver.com/search.naver?query=로또+${round}회`;
  try {
    const res = await fetchWithTimeout(url, 10000, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-S918N) Chrome/119.0.0.0 Mobile Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });
    if (!res.ok) return null;
    const html = await res.text();
    
    // 네이버 로또 당첨번호 정규식 파싱
    const nums = [];
    const regex = /<span class="num[^>]*>(\d+)<\/span>/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
      nums.push(Number(match[1]));
    }

    if (nums.length >= 7) {
       return {
          round: round,
          numbers: nums.slice(0, 6).sort((a,b)=>a-b),
          bonus: nums[6]
        };
    }

  } catch (e) {
    console.log(`[네이버 파싱 오류] ${e.message}`);
  }
  return null;
}

async function run() {
  console.log('==================================================');
  console.log('[작업 시작] 로또 회차 자동 수집 (듀얼 엔진 모드)');
  console.log('==================================================');

  let history = [];
  if (fs.existsSync(HISTORY_PATH)) {
    const raw = fs.readFileSync(HISTORY_PATH, 'utf-8');
    history = JSON.parse(raw);
  }

  history.sort((a, b) => Number(b.round || 0) - Number(a.round || 0));

  const latestRecordedRound = history.length > 0 
    ? Math.max(...history.map(d => Number(d.round || 0))) 
    : 0;
  
  let targetRound = latestRecordedRound + 1;
  let hasNewData = false;

  console.log(`[정보] 현재 보관된 최신 회차: ${latestRecordedRound}회`);

  // 누락된 회차를 모두 찾을 때까지 연속 조회 (while 루프 적용)
  while (true) {
    console.log(`\n[진행] 제 ${targetRound}회차 수집 시도 중...`);
    
    let drawData = await fetchFromDhLottery(targetRound);
    
    if (!drawData) {
      console.log(`[우회] 동행복권 API 데이터를 가져올 수 없습니다. 네이버 검색 결과로 우회합니다.`);
      drawData = await fetchFromNaver(targetRound);
    }
    
    if (drawData) {
      history.unshift(drawData);
      hasNewData = true;
      console.log(`[성공] 제 ${drawData.round}회 당첨번호 수집 완료: ${drawData.numbers.join(', ')} + 보너스 ${drawData.bonus}`);
      targetRound++;
      // 서버 과부하 방지
      await new Promise(resolve => setTimeout(resolve, 1500));
    } else {
      console.log(`[종료] 제 ${targetRound}회차 결과를 찾을 수 없습니다. (아직 추첨 전이거나 데이터 없음)`);
      break;
    }
  }

  if (hasNewData) {
    history.sort((a, b) => Number(b.round || 0) - Number(a.round || 0));
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 4), 'utf-8');
    console.log(`\n[완료] 새로운 회차 데이터가 성공적으로 저장되었습니다. (lotto-history.json 누적 갱신 완료)`);
  } else {
    console.log(`\n[완료] 추가할 새로운 회차가 없습니다.`);
  }
  console.log('==================================================');
}

run();
