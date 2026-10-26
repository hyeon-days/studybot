#!/bin/bash
# Oracle 서버를 만들 때 '초기화 스크립트(cloud-init)' 칸에 이 내용을 통째로 붙여 넣는다.
# 아래 따옴표 안의 글자만 본인 봇 토큰으로 바꾸면, 서버가 처음 켜질 때 봇이 자동으로 설치되고 실행된다.
DISCORD_TOKEN="여기에_봇_토큰을_붙여넣기"

# 진행 기록은 서버의 /var/log/studybot-setup.log 에 남는다.
sudo -u ubuntu -H env DISCORD_TOKEN="$DISCORD_TOKEN" bash -c \
  'curl -fsSL https://raw.githubusercontent.com/hyeon-days/studybot/main/scripts/setup-server.sh | bash' \
  >/var/log/studybot-setup.log 2>&1
