name: Auto Lotto Update

on:
  schedule:
    # KST 20:40, 20:50 (UTC 11:40, 11:50)
    - cron: '40,50 11 * * 6'
    # KST 21:00 ~ 22:50 (UTC 12:00 ~ 13:50, 10분 간격)
    - cron: '*/10 12,13 * * 6'
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: lotto-update-group
  cancel-in-progress: false

jobs:
  update:
    runs-on: ubuntu-24.04
    steps:
      - name: 저장소 체크아웃
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Node.js 22 세팅
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: 최신 당첨 번호 스크래핑 및 JSON 갱신
        run: node scripts/update-lotto.js

      - name: Git Commit & Push (Cloudflare Pages 자동 배포)
        run: |
          git config --global user.name 'Aipluslotto-Bot'
          git config --global user.email 'bot@aipluslotto.com'
          git add data/lotto-history.json

          if git diff --staged --quiet; then
            echo "갱신할 새 회차 데이터가 없습니다. (이미 최신이거나 미발표)"
          else
            git commit -m "Auto update lotto-history.json"
            git pull --rebase origin main
            git push origin main
            echo "새 회차 데이터 업데이트 및 Push 완료"
          fi
