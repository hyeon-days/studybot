# 무료로 봇 띄우기 (Oracle Cloud Always Free)

이 봇은 24시간 켜져 있어야 하고, 공부시간 기록을 SQLite 파일에 저장하므로 디스크가 유지되는 서버가 필요합니다. 일정 시간 요청이 없으면 잠드는 무료 웹호스팅(Render 무료 플랜 등)은 맞지 않습니다. 비용 없이 쓸 수 있는 선택지 중에서는 Oracle Cloud의 Always Free 가상서버가 가장 무난합니다.

> 클라우드 회사의 무료 정책은 바뀔 수 있습니다. 가입 전에 Oracle 공식 Always Free 안내 페이지에서 현재 조건을 한 번 확인하세요.

## 0. 준비물

- 본인 명의 신용카드 또는 해외결제 가능한 체크카드. 본인 확인용이며, 무료 자원만 쓰면 청구되지 않습니다. 가입 시 소액 승인 후 취소가 될 수 있습니다.
- 디스코드 봇 토큰 ([README](../README.md#1-디스코드-봇-만들기) 1단계)

카드가 없다면 집에 24시간 켜 둘 수 있는 PC나 노트북에서 실행하는 방법도 있습니다. 이 경우 README의 '서버에서 실행하기'를 따르면 됩니다.

## 1. 가입

1. https://www.oracle.com/cloud/free/ 에서 Start for free로 가입합니다.
2. **Home Region은 나중에 바꿀 수 없습니다.** South Korea Central (Seoul) 또는 South Korea North (Chuncheon)를 고르세요. 무료 서버는 Home Region에서만 만들 수 있습니다.
3. 가입 승인이 바로 안 되거나 거절되는 경우가 있습니다. 이때는 다른 카드나 시간을 두고 다시 시도합니다.

## 2. 서버 만들기

1. 콘솔 메뉴에서 Compute > Instances > Create instance를 엽니다.
2. **Image:** Change image > Ubuntu > Canonical Ubuntu 24.04 (또는 22.04)를 고릅니다.
3. **Shape:** Change shape에서 'Always Free-eligible' 표시가 있는 것을 고릅니다.
   - Ampere (VM.Standard.A1.Flex): 1 OCPU, 6GB 메모리면 충분합니다. 'Out of capacity' 오류가 나면 아래 AMD를 고르거나 시간을 두고 다시 시도합니다.
   - AMD (VM.Standard.E2.1.Micro): 메모리 1GB지만 이 봇에는 충분합니다. 설치 스크립트가 스왑을 자동으로 만들어 줍니다.
4. **Add SSH keys:** 'Generate a key pair for me'를 고르고 **Save private key**로 키 파일(`.key`)을 꼭 내려받습니다. 이 파일이 없으면 서버에 접속할 수 없습니다.
5. Create를 누르고, 상태가 RUNNING이 되면 Public IP address를 복사해 둡니다.

봇은 디스코드로 나가는 연결만 쓰므로 방화벽(포트) 설정은 건드리지 않아도 됩니다.

## 3. 서버 접속

Windows는 PowerShell, macOS는 터미널에서 실행합니다. 경로와 IP는 본인 것으로 바꾸세요.

```bash
# macOS/Linux에서는 키 파일 권한을 먼저 좁혀야 합니다
chmod 600 ~/Downloads/ssh-key-*.key

ssh -i ~/Downloads/ssh-key-2026-10-27.key ubuntu@123.45.67.89
```

Windows에서 'bad permissions' 오류가 나면 키 파일을 `C:\Users\본인이름\.ssh\` 폴더로 옮긴 뒤 다시 시도합니다.

## 4. 봇 설치

접속한 서버에서 아래 한 줄을 실행합니다. 중간에 봇 토큰을 물어보면 붙여 넣고 Enter를 누릅니다(입력한 글자는 화면에 보이지 않습니다).

```bash
curl -fsSL https://raw.githubusercontent.com/hyeon-days/studybot/main/scripts/setup-server.sh | bash
```

스크립트는 Node.js와 pm2 설치, 코드 받기와 빌드, 토큰 저장, 실행, 재부팅 시 자동 시작 등록까지 처리합니다. 끝나면 로그를 확인합니다.

```bash
pm2 logs study-bot
```

`Ready! Logged in as ...`가 보이면 성공입니다(Ctrl+C로 로그 보기 종료, 봇은 계속 실행됩니다). 이제 디스코드에서 README의 '설치 직후 할 일'을 진행하세요.

## 운영

| 하고 싶은 일 | 명령어 |
| --- | --- |
| 로그 보기 | `pm2 logs study-bot` |
| 상태 보기 | `pm2 status` |
| 재시작 | `pm2 restart study-bot` |
| 코드 업데이트 | 설치 명령을 다시 실행 (`curl ... \| bash`) |
| 토큰 바꾸기 | `nano ~/studybot/.env` 수정 후 `pm2 restart study-bot` |
| 데이터 백업 | `~/studybot/data/bot.sqlite` 파일을 복사 |

## 주의: 유휴 서버 회수

Oracle은 Always Free 서버의 CPU, 네트워크, 메모리 사용량이 일주일 내내 아주 낮으면 '유휴 서버'로 보고 회수(정지)할 수 있다고 안내하고 있습니다. 이 봇은 자원을 거의 쓰지 않아 여기에 걸릴 가능성이 있습니다. 가장 확실한 방법은 계정을 Pay As You Go로 업그레이드하는 것입니다. 업그레이드해도 Always Free 범위 안의 자원만 쓰면 요금은 0원이고, 유휴 회수 대상에서 빠집니다. 업그레이드한다면 Billing > Budgets에서 1달러 예산 알림을 걸어 두면 실수로 유료 자원을 만들었을 때 바로 알 수 있습니다.

회수되더라도 부트 볼륨(디스크)은 남아 있어 다시 시작하면 되지만, 그 사이 공부시간 기록이 빠지므로 주기적으로 `pm2 status`를 확인하거나 `bot.sqlite`를 백업해 두세요.
