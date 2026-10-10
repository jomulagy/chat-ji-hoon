# CHAT 지훈띠

React + TypeScript 채팅 화면을 Capacitor로 패키징합니다. iPhone 네이티브 앱은 Swift 플러그인과 Apple Foundation Models를 사용하고, GitHub Pages 브라우저 빌드는 Cloudflare Worker를 거쳐 Gemini API로 메시지 의도를 분류합니다. 두 경로 모두 미리 정한 12개 답변 중 하나만 표시합니다.

## 웹 앱 AI 연결

GitHub Pages는 정적 파일을 제공하므로 Gemini API 키를 프론트엔드에 넣으면 공개됩니다. 브라우저는 Cloudflare Worker에 요청하고, Worker가 Gemini API 키를 비밀값으로 보관해 모델을 호출합니다. Worker는 모델이 정해진 의도 코드만 반환하도록 제한하고, 실제 채팅 문구는 Worker에서 허용된 목록과 매핑합니다.

### Worker 배포

1. Google AI Studio에서 Gemini API 키를 발급합니다. 키를 Git 저장소나 웹 앱 설정에 넣지 마세요.
2. 이 저장소 루트에서 Wrangler로 로그인합니다.

   ```sh
   pnpm dlx wrangler login
   ```

3. Gemini API 키를 Worker 비밀값으로 저장합니다.

   ```sh
   pnpm dlx wrangler secret put GEMINI_API_KEY
   ```

4. 앱 설정에서 사용할 별도 접속 코드를 만들어 비밀값으로 저장합니다. 예를 들어 Node.js가 설치된 환경에서 아래 명령은 무작위 64자리 16진수 코드를 출력합니다. 이 코드를 안전하게 보관해 두세요.

   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   pnpm dlx wrangler secret put APP_ACCESS_TOKEN
   ```

5. Worker를 배포합니다.

   ```sh
   pnpm dlx wrangler deploy
   ```

6. 배포가 끝나면 나온 `https://...workers.dev` 주소와 `APP_ACCESS_TOKEN`을 웹 앱의 **AI 설정**에 입력하고 연결을 확인합니다. 접속 코드는 브라우저의 해당 기기에 저장되며 Gemini API 키는 저장되지 않습니다.

`wrangler.toml`에서 모델과 허용 웹 주소를 설정할 수 있습니다. `ALLOWED_ORIGINS`에는 배포된 Pages 주소를 포함해야 합니다. 현재 기본 주소는 `https://jomulagy.github.io`입니다. 프로젝트가 `/chat-ji-hoon/` 하위 경로에 배포되어도 Origin은 도메인까지만 지정합니다. 별도 도메인을 쓰면 해당 Origin을 추가하고 다시 배포하세요.

### 무료 사용 및 개인정보

Gemini API 무료 사용량과 제한은 모델 및 Google 정책에 따라 바뀔 수 있습니다. 무료 등급 요청은 Google 서비스 개선에 사용될 수 있으므로 민감한 개인정보나 비밀 대화는 입력하지 마세요. API 이용 조건과 최신 한도는 [Gemini API 가격 및 요금](https://ai.google.dev/gemini-api/docs/pricing), [API 키 보안 안내](https://ai.google.dev/gemini-api/docs/api-key), [Gemini API 추가 서비스 약관](https://ai.google.dev/gemini-api/terms?hl=ko)에서 확인하세요.

Cloudflare Worker는 외부 인터넷에서 호출되므로 무료 사용량만으로 무제한 또는 비공개 서비스가 보장되지는 않습니다. 접속 코드를 공유하지 말고 Google AI Studio와 Cloudflare 대시보드에서 사용량을 확인하세요.

## 개발 및 iPhone 앱

개발 도구는 Node.js 20 이상, pnpm, 그리고 iOS 빌드용 macOS/Xcode가 필요합니다.

```sh
pnpm install
pnpm run ios:prepare
cd ios/App && pod install && cd ../..
pnpm run ios:open
```

iOS 프로젝트는 `ios/App`에 있습니다. Xcode에서 Apple Developer Team을 설정하고 실제 iPhone 대상으로 서명 및 빌드합니다. iOS 26 이상, Apple Intelligence 지원 기기 및 모델 사용 가능 상태가 필요합니다. GitHub Actions의 서명 없는 빌드 산출물은 iPhone에 직접 설치할 수 없으며, TestFlight 배포에는 Apple 개발자 계정과 서명 설정이 필요합니다.

브라우저 빌드는 로컬에 대형 모델을 다운로드하지 않습니다. 네트워크 연결과 Worker 설정이 있어야 AI 분류를 사용할 수 있습니다. iPhone 네이티브 앱은 기존 온디바이스 Foundation Models 경로를 계속 사용하며 Worker 주소를 요구하지 않습니다.

## 기능

- 여러 번 나눠 보낸 메시지를 마지막 입력 5초 뒤 합쳐 한 번 분류
- 브라우저 빌드는 Gemini API로 의도 분류, iPhone 앱은 Apple Foundation Models로 온디바이스 분류
- 브라우저 AI Worker 연결 상태를 시작 화면과 설정에서 확인
- 채팅 기록 저장, 조회, 초기화
- 앱 전용 `Application Support/local-chat.sqlite` SQLite 저장소 (iOS 네이티브)
- 온디바이스 모델 지침: `native/ios/on-device-model-guidance.md`

## 허용 답변

`ㄱㅊ아`, `아현 걱정하지마`, `아현 잘할수있어`, `이애가 진짜`, `그런거 아니야`, `안돼`, `ㅇㄹㅅㄱ`, `ㄱㅇㅇ`, `아현 무슨일이야`, `ㅇㅎ`, `오구`, `웅` 중 하나만 답변으로 표시합니다. 예를 들어 맥락 없이 “좆됐어”라고 하면 무심한 반응 대신 `아현 무슨일이야`를 고르도록 지시합니다.

## 배포 구성

- 프론트엔드: GitHub Pages
- 웹 AI 프록시: `cloudflare/src/index.ts` Cloudflare Worker
- AI 분류 API: Google Gemini API
- iPhone 앱 AI: Apple Foundation Models (네이티브 빌드)

브라우저 앱에서 모델이 생성한 자유 형식 답변은 사용하지 않습니다. 모델은 허용된 의도 코드만 선택하고, 표시 문자열은 앱/Worker의 고정 목록에서 가져옵니다.
