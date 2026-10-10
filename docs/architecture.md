# 구현 메모

## 구성
- `src/`: React UI와 Capacitor 호출 계약
- `ios/App/App/LocalChatPlugin.swift`: 네이티브 채팅·SQLite 구현

## 교체 지점
`IntentAnalyzer.answer(for:)`를 모델 어댑터로 교체한다. 모델은 미리 정한 의도 코드만 반환하고 Swift가 화이트리스트 검증 후 정적 답변을 고른다. 사용자 입력은 외부 네트워크로 전송하지 않는다.
