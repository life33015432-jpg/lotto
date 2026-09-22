// scripts/update-lotto.js
const fs = require('fs');
const path = require('path');

const HISTORY_PATH = path.join(__dirname, '../data/lotto-history.json');

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

    console.log(`기존 최신 회차: ${latestRecordedRound}회, 조회 대상: ${targetRound}회`);

    const apiUrl = `https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=${targetRound}`;
    const res = await fetch(apiUrl);
    const data = await res.json();

    if (data.returnValue !== 'success') {
      console.log(`[알림] ${targetRound}회차 당첨 정보가 아직 공개되지 않았습니다. (동행복권 응답: ${data.returnValue})`);
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
    console.error('[오류] 당첨 번호 업데이트 도중 에러 발생:', err);
    process.exit(1);
  }
}

run();
