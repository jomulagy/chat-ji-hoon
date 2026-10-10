# CHAT 지훈띠 (iPhone)

React + TypeScript 화면을 Capacitor로 패키징하고, 대화 처리와 SQLite 파일 저장을 Swift 네이티브 플러그인에서 수행합니다. iOS 26 이상에서 Apple Foundation Models로 한국어 입력을 분류해 지정된 답변 중 하나를 선택합니다. 앱 시작 시 실제 모델 응답을 확인하고, 모델을 사용할 수 없으면 대화를 시작하지 않습니다.

## 개발 환경

- Node.js 20 이상, pnpm
- macOS와 Xcode (iOS 프로젝트 생성·빌드·기기 설치에 필요)
- Xcode 26 SDK (Foundation Models API 사용)
- Apple Developer Program 가입 및 Xcode 서명 팀 설정 (TestFlight 배포용)

## 시작

```sh
pnpm install
pnpm run ios:prepare
cd ios/App && pod install && cd ../..
pnpm run ios:open
```

iOS Xcode 프로젝트는 저장소의 `ios/App` 아래에 포함되어 있습니다. Swift 플러그인은 Xcode 프로젝트에 등록되어 있고 앱 시작 시 bridge에 연결됩니다. 온디바이스 모델 지침 Markdown 파일도 Xcode의 Copy Bundle Resources에 포함됩니다. Xcode에서 Apple Developer Team을 선택하고 bundle identifier `com.jihun.chatjihun`을 해당 계정에서 사용할 수 있는지 확인한 뒤 실제 iPhone 대상으로 Archive를 만듭니다.

프로젝트를 GitHub 저장소에 올리면 `.github/workflows/ios-build.yml`이 GitHub Actions macOS 러너에서 서명 없는 iOS 빌드를 수행합니다. 빌드 산출물은 Actions 실행 결과에서 다운로드할 수 있지만, unsigned `.app`은 iPhone에 직접 설치하거나 TestFlight에 올릴 수 없습니다. TestFlight 배포에는 Apple 개발자 계정, 서명 인증서 및 프로비저닝 설정이 추가로 필요합니다.

## 카카오톡으로 설치 안내를 보내기

권장 경로는 TestFlight입니다. Xcode Organizer에서 Archive를 App Store Connect에 업로드한 다음 TestFlight 테스터 초대 링크를 만들어 카카오톡으로 공유합니다. 사용자는 링크에서 TestFlight로 앱을 설치합니다. 앱을 수정하면 새 빌드를 올려야 합니다.

`.ipa` 파일을 카카오톡 첨부로 보내는 것만으로는 iPhone에서 탭해 바로 설치할 수 없습니다. Ad Hoc 배포는 설치할 모든 iPhone의 UDID를 Apple 개발자 계정에 등록하고 해당 기기용 프로비저닝으로 서명해야 하며, Apple 안내에 따라 Xcode 또는 Apple Configurator로 설치합니다. 다운로드 후 간단히 설치하는 목적에는 TestFlight가 더 적합합니다.

이 PC는 Windows 환경이라 Xcode 서명 및 Archive를 만들 수 없습니다. 따라서 현재 산출물에는 완성된 설치용 IPA가 포함되지 않습니다. 위 단계를 macOS/Xcode와 Apple Developer 계정이 있는 환경에서 완료해야 실제 설치 링크를 발급할 수 있습니다.

브라우저 빌드는 Hugging Face Transformers.js와 다국어 문장 임베딩 모델을 사용해 한국어 입력을 12개 응답 의도 예시와 비교합니다. 모델 추론은 브라우저 안에서 수행하며 대화 내용을 외부 서버로 보내지 않습니다. 모델 파일은 Hugging Face에서 최초 실행 시 내려받으므로 처음에는 인터넷 연결과 다운로드 시간이 필요합니다. 모델 로딩 또는 추론에 실패하면 브라우저 안의 기존 규칙 분류로 응답합니다. iPhone 네이티브 앱은 기존 Apple Foundation Models 경로를 계속 사용합니다.

## 구현된 기능

- 채팅 화면, 전송 중 상태, 오류 표시
- Capacitor `LocalChat` 플러그인 계약
- 여러 번 나눠 보낸 메시지를 사용자 입력으로 저장하고, 마지막 입력 5초 뒤 합쳐서 한 번 답변
- 브라우저 빌드에서 Transformers.js 기반 다국어 의미 분류로 허용 답변 선택 (실패 시 로컬 규칙 기반 대체)
- iPhone 네이티브 빌드에서 Swift로 합쳐진 메시지를 제한 분류하고 허용 답변 선택
- Apple Foundation Models 온디바이스 분류 (지원 기기·OS·언어에서)
- iPhone 앱 시작 시 온디바이스 AI에 실제 분류 요청을 보내 연결과 응답을 확인하고, 실패하면 오류 화면에서 채팅 진입을 차단
- 온디바이스 모델의 목적·감정 분류 지침을 담은 `native/ios/on-device-model-guidance.md`
- 앱 전용 `Application Support/local-chat.sqlite` SQLite 저장소
- 대화 조회, 초기화

## 등록된 답변 목록

현재 답변은 다음 12개로 제한되어 있습니다: `ㄱㅊ아`, `아현 걱정하지마`, `아현 잘할수있어`, `이애가 진짜`, `그런거 아니야`, `안돼`, `ㅇㄹㅅㄱ`, `ㄱㅇㅇ`, `아현 무슨일이야`, `ㅇㅎ`, `오구`, `웅`. 브라우저 의미 분류 예시는 `src/browserIntentModel.ts`, 네이티브 분류기는 Swift `IntentAnalyzer`에서 조정할 수 있습니다.

## 온디바이스 모델

브라우저 빌드는 Transformers.js의 `feature-extraction` 파이프라인과 [`Xenova/paraphrase-multilingual-MiniLM-L12-v2`](https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2) 양자화 모델을 사용합니다. 문장 임베딩 유사도로 허용된 의도만 선택합니다. 모델 가중치 파일은 약 399 MB이며 첫 실행 때 내려받습니다. [Transformers.js](https://huggingface.co/docs/transformers.js)는 브라우저 내부 추론을 지원합니다.

iPhone 네이티브 빌드에서는 Swift의 `IntentAnalyzer`가 Apple Foundation Models 프레임워크의 `SystemLanguageModel`을 호출합니다. 시스템 모델은 iOS 26 이상과 Apple Intelligence 지원 및 모델 준비 상태가 필요하며, 한국어 로케일 지원 여부도 확인합니다. 입력 분석은 기기에서 실행됩니다. 모델이 불가용하거나 결과가 허용된 의도 코드와 일치하지 않으면 규칙 분류기로 처리합니다. 별도 모델 파일을 앱에 포함하지 않습니다.

Apple 문서: [Foundation Models](https://developer.apple.com/documentation/FoundationModels), [모델 가용성](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel), [지원 로케일 확인](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel/supportslocale%28_%3A%29).

iOS 앱은 운영체제 정책상 앱 코드가 임의로 앱 프로세스를 종료할 수 없습니다. 모델을 사용할 수 없을 때 오류 화면만 표시하고 대화 기능을 막으며, 사용자가 앱 전환 화면에서 앱을 닫도록 안내합니다. 브라우저에서는 AI 모델 로딩이 실패해도 규칙 기반 대체 응답으로 계속 사용할 수 있습니다.

MCP 서버는 사용하지 않습니다. 앱 내부에서 Foundation Models를 직접 호출하므로 별도 도구 서버가 필요하지 않습니다. 다음 단계는 macOS/Xcode에서 앱을 생성하고 실제 iPhone에서 모델 동작을 확인하는 것입니다.

