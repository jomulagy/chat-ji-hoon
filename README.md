# CHAT 지훈띠

React + TypeScript로 만든 웹 채팅 앱입니다. Gemini API는 Cloudflare Worker를 통해 호출하며, 대화 기록은 Worker의 SQLite 기반 Durable Object에 저장합니다.

## 대화 기록 저장

로컬과 GitHub Pages에서 같은 `/messages` API와 같은 저장 형식을 사용합니다. 브라우저는 로컬 Worker 또는 배포된 Worker에 JSON으로 대화 메시지를 전달하고, Worker가 SQLite 데이터베이스에 영구 저장합니다. 로컬 테스트 데이터는 `.wrangler/state` 아래에 생성되며 Git에는 올라가지 않습니다. GitHub Pages에서는 배포 Worker의 데이터베이스에 저장됩니다.

API는 다음과 같습니다.

- `GET /messages`: `{ "messages": [...] }` 형식으로 대화 기록 조회
- `POST /messages`: 메시지 JSON 한 건 저장
- `DELETE /messages`: 대화 기록 전체 초기화

GitHub Pages에서 `<Pages 앱 주소>/messages`를 열거나 채팅 화면의 **서버 기록**을 누르면 앱이 Worker API를 호출해 JSON 기록을 표시합니다. Pages 배포에서 `404.html`을 사용해 앱 경로를 지원합니다.

로컬에서는 저장소 루트에서 Worker와 웹 앱을 실행합니다.

```powershell
pnpm run worker:dev
pnpm dev
```

두 번째 명령은 다른 터미널에서 실행하고, `http://localhost:5173`을 엽니다. 앱을 통해 기록을 조회하거나 저장할 수 있고, API도 `http://localhost:5173/api/messages`에서 호출할 수 있습니다. 예를 들어 PowerShell에서 조회하려면:

```powershell
Invoke-RestMethod http://localhost:5173/api/messages
```

로컬 요청은 Vite가 Worker로 전달하고 `.dev.vars`의 `APP_ACCESS_TOKEN`을 서버 쪽에서 붙입니다. Gemini 키와 접속 코드는 `.dev.vars`에 저장하며 Git에 커밋하지 않습니다.

## Gemini Worker 설정

GitHub Pages는 정적 사이트이므로 Gemini API 키를 포함할 수 없습니다. 브라우저는 Cloudflare Worker를 호출하고, API 키는 Worker Secret으로 보관합니다. GitHub 저장소의 **Settings → Secrets and variables → Actions**에 아래 항목을 등록합니다.

**Repository secrets**

- `GEMINI_API_KEY`: Google AI Studio에서 발급한 Gemini API 키
- `CLOUDFLARE_API_TOKEN`: Worker 배포 권한이 있는 Cloudflare API 토큰
- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare 계정 ID

**Repository variable**

- `GEMINI_WORKER_URL`: 배포된 Worker 주소(예: `https://chat-jihun-gemini.<계정-subdomain>.workers.dev`)

먼저 **Actions → Deploy Gemini Worker → Run workflow**를 실행합니다. Worker가 배포된 후 주소를 `GEMINI_WORKER_URL`에 등록하고, Pages 배포 워크플로를 실행합니다. 이후 `main` 또는 `master`에 푸시하면 Worker와 Pages가 자동 배포됩니다.

첫 Worker 배포는 Durable Object SQLite 마이그레이션을 적용합니다. 배포 후 대화 기록이 저장되는지 확인할 수 있습니다. Worker를 삭제하거나 새 이름으로 바꾸면 이전 Durable Object 데이터와 연결이 끊길 수 있습니다.

## 로컬 개발

필요 도구: Node.js 20 이상 및 pnpm.

```powershell
Copy-Item .dev.vars.example .dev.vars
pnpm install
pnpm run worker:dev
```

별도 터미널에서 `pnpm dev`를 실행한 다음 `http://localhost:5173`을 엽니다. 로컬 Worker는 Cloudflare 개발 런타임의 로컬 Durable Object 저장소를 사용하며 `.wrangler/state`에 보존됩니다.

## 기능

- 여러 번 나눠 보낸 메시지를 마지막 입력 3초 뒤 합쳐 분석
- Gemini AI가 의도를 분류하고 지정된 답변 중 하나를 표시
- Worker가 답변을 먼저 서버 기록에 저장하고 같은 요청 재시도에는 기존 답변을 반환
- 앱 시작 시 AI Worker 연결 확인
- 대화 기록 저장, 조회, 초기화
- 로컬 및 배포에서 동일한 JSON API와 저장 규칙 사용

허용 답변은 `ㄱㅊ아`, `아현 걱정하지마`, `아현 괜찮아?`, `아현 잘할수있어`, `이애가 진짜`, `그런거 아니야`, `안돼`, `ㅇㄹㅅㄱ`, `ㄱㅇㅇ`, `아현 무슨일이야`, `ㅇㅎ`, `오구`, `나도 사랑해`, `웅`, `알았어`, `미안해`, `먹으러 가자`, `좋아`, `차 태워줄게`, `안녕`, `지훈이한테 물어봐`입니다. 단독 인사 `안녕`에는 `안녕`, 일반적인 배고픔에는 `오구`, 먹고 싶은 음식이 구체적으로 나오면 `먹으러 가자`, 함께 먹자는 제안에는 `좋아`, `웅언제`나 `언제!!!!`에는 `지훈이한테 물어봐`로 답합니다. 사랑을 직접 표현하면 `나도 사랑해`, 중립적인 부름에는 `아현 무슨일이야`, 답변을 못한다고 항의하면 `미안해`, `ㅇㅎ`는 한숨으로 보고 `ㅇㅎ`, 슬픔·속상함이나 이미 설명한 사건에 대한 아픔에는 `아현 괜찮아?`, 추위와 졸림에는 `오구`, 기다려 달라는 말에는 `알았어`, 걷기 싫다는 말에는 `차 태워줄게`로 답하도록 분류합니다. `이애가 진짜`는 가벼운 장난스러운 대화에서만 선택합니다.

## 배포 구성

- 프론트엔드: GitHub Pages
- Gemini 분류 API 및 대화 기록 API: Cloudflare Worker
- 대화 기록 저장소: Cloudflare Durable Object SQLite
- AI 모델: Google Gemini API

Gemini 무료 사용량과 데이터 처리 정책은 바뀔 수 있습니다. 민감한 개인정보나 비밀 대화는 입력하지 마세요.
# 답변이 오지 않을 때 확인

`/messages` 페이지 하단의 **답변 진단 로그**를 열면 브라우저와 Worker가 남긴 최근 진단 기록을 볼 수 있습니다. 진단에는 질문 본문을 넣지 않고 요청 ID, 단계, 오류 코드, HTTP 상태, 소요 시간, 기기 종류만 저장합니다. Worker에 로그를 보낼 수 없는 경우에는 해당 브라우저의 로컬 저장소와 개발자 콘솔에 남깁니다.

- `reply_started`만 있고 `worker_received`가 없으면 Worker가 요청을 받기 전 네트워크/CORS/라우팅에서 실패했을 가능성이 있습니다.
- `worker_received`가 있지만 `reply_succeeded` 또는 `reply_failed`가 없으면 Worker, Gemini 또는 기록 저장 처리 중 멈췄을 가능성이 있습니다.
- `reply_failed`의 코드와 HTTP 상태로 타임아웃, 네트워크 오류, Worker 오류 등을 구분할 수 있습니다.
- `unanswered_recovered`는 앱을 다시 열었을 때 앞선 답변이 저장되지 않은 사용자 메시지를 발견해 재처리를 시도했음을 뜻합니다.

서버 로그는 Cloudflare Worker의 `CHAT_HISTORY` Durable Object에 최근 200건을 보관합니다. 로그를 기록하는 기능이 배포된 뒤 발생한 요청부터 확인할 수 있습니다.
