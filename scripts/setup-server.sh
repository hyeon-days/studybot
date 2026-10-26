#!/usr/bin/env bash
# Ubuntu 22.04/24.04 서버에서 study-bot을 설치(또는 업데이트)하고 pm2로 상시 실행한다.
# 사용법: curl -fsSL https://raw.githubusercontent.com/hyeon-days/studybot/main/scripts/setup-server.sh | bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/hyeon-days/studybot.git}"
APP_DIR="${APP_DIR:-$HOME/studybot}"
APP_NAME="study-bot"

echo "[1/5] 스왑 메모리 확인"
# 메모리 1GB 서버에서 npm 설치나 빌드가 메모리 부족으로 죽지 않도록 2GB 스왑을 만든다.
if [ -z "$(swapon --show --noheadings)" ]; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo "[2/5] Node.js, git, pm2 설치"
sudo apt-get update -qq
sudo apt-get install -y -qq git curl build-essential python3 >/dev/null
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >/dev/null
  sudo apt-get install -y -qq nodejs >/dev/null
fi
command -v pm2 >/dev/null || sudo npm install -g pm2 --silent

echo "[3/5] 코드 받기와 빌드"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"
npm ci --no-audit --no-fund
npm run build

echo "[4/5] 봇 토큰 설정"
if ! grep -qs '^DISCORD_TOKEN=..*' .env; then
  # 파이프(curl | bash)로 실행해도 키보드 입력을 받도록 /dev/tty에서 읽는다.
  read -rsp "디스코드 봇 토큰을 붙여넣고 Enter (화면에 표시되지 않음): " token </dev/tty
  echo
  printf 'DISCORD_TOKEN=%s\nDB_PATH=data/bot.sqlite\n' "$token" >.env
  chmod 600 .env
fi

echo "[5/5] pm2로 실행"
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 restart "$APP_NAME" --update-env
else
  pm2 start dist/index.js --name "$APP_NAME" --node-args="--env-file=.env"
fi
pm2 save
# 서버가 재부팅돼도 봇이 다시 켜지도록 systemd에 등록한다.
sudo env PATH="$PATH" "$(command -v pm2)" startup systemd -u "$USER" --hp "$HOME" >/dev/null

echo
echo "완료. 'pm2 logs $APP_NAME'에서 'Ready! Logged in as ...'가 보이면 정상입니다."
