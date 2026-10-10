import Capacitor
import Foundation
import SQLite3
#if canImport(FoundationModels)
import FoundationModels
#endif

@objc(LocalChatPlugin)
public class LocalChatPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LocalChatPlugin"
    public let jsName = "LocalChat"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "appendUserMessage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "generateReply", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getMessages", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearMessages", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getRuntimeStatus", returnType: CAPPluginReturnPromise)
    ]

    private var db: OpaquePointer?
    private let queue = DispatchQueue(label: "local.chat.storage")

    override public func load() {
        super.load()
        do { try openDatabase() }
        catch { NSLog("LocalChat database initialization failed: %@", error.localizedDescription) }
    }

    deinit { if db != nil { sqlite3_close(db) } }

    @objc func getRuntimeStatus(_ call: CAPPluginCall) {
        Task {
            let modelReady = await IntentAnalyzer().verifyModelConnection()
            let message = modelReady ? "Apple 온디바이스 AI 연결 및 응답 확인 완료" : "Apple 온디바이스 AI에 연결할 수 없습니다"
            DispatchQueue.main.async {
                call.resolve(["ready": self.db != nil, "modelReady": modelReady, "message": message])
            }
        }
    }

    @objc func appendUserMessage(_ call: CAPPluginCall) {
        guard let text = call.getString("text")?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else {
            call.reject("메시지를 입력해 주세요.", "INVALID_MESSAGE"); return
        }
        guard text.count <= 2000 else { call.reject("메시지는 2,000자 이내로 입력해 주세요.", "MESSAGE_TOO_LONG"); return }
        queue.async {
            let user = self.makeMessage(role: "user", content: text)
            do {
                try self.insert(user)
                DispatchQueue.main.async { call.resolve(["userMessage": user]) }
            } catch {
                DispatchQueue.main.async { call.reject("메시지를 저장하지 못했습니다.", "CHAT_ERROR", error) }
            }
        }
    }

    @objc func generateReply(_ call: CAPPluginCall) {
        guard let text = call.getString("text")?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else {
            call.reject("분석할 메시지가 없습니다.", "INVALID_MESSAGE"); return
        }
        guard text.count <= 8000 else { call.reject("한 번에 분석할 내용이 너무 깁니다.", "MESSAGE_TOO_LONG"); return }
        Task {
            let (intent, answer) = await IntentAnalyzer().answer(for: text)
            let service = self.makeMessage(role: "service", content: answer, intent: intent)
            self.queue.async {
                do {
                    try self.insert(service)
                    DispatchQueue.main.async { call.resolve(["serviceMessage": service]) }
                } catch {
                    DispatchQueue.main.async { call.reject("답변을 저장하지 못했습니다.", "CHAT_ERROR", error) }
                }
            }
        }
    }

    @objc func getMessages(_ call: CAPPluginCall) {
        queue.async {
            do {
                let messages = try self.readMessages()
                DispatchQueue.main.async { call.resolve(["messages": messages]) }
            } catch { DispatchQueue.main.async { call.reject("대화 내역을 읽지 못했습니다.", "STORAGE_ERROR", error) } }
        }
    }

    @objc func clearMessages(_ call: CAPPluginCall) {
        queue.async {
            guard let db = self.db else { DispatchQueue.main.async { call.reject("저장소가 준비되지 않았습니다.") }; return }
            let result = sqlite3_exec(db, "DELETE FROM messages;", nil, nil, nil)
            if result == SQLITE_OK { DispatchQueue.main.async { call.resolve() } }
            else { DispatchQueue.main.async { call.reject("대화 내역을 지우지 못했습니다.", "STORAGE_ERROR") } }
        }
    }

    private func openDatabase() throws {
        let url = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("local-chat.sqlite")
        guard sqlite3_open(url.path, &db) == SQLITE_OK, let db else { throw storageError() }
        sqlite3_exec(db, "PRAGMA journal_mode=WAL;", nil, nil, nil)
        let sql = "CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, role TEXT NOT NULL, content TEXT NOT NULL, intent TEXT, created_at TEXT NOT NULL);"
        guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw storageError() }
    }

    private func insert(_ message: [String: Any]) throws {
        guard let db else { throw storageError() }
        let sql = "INSERT INTO messages (id, role, content, intent, created_at) VALUES (?, ?, ?, ?, ?);"
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else { throw storageError() }
        defer { sqlite3_finalize(statement) }
        bind(message["id"] as? String, to: 1, in: statement)
        bind(message["role"] as? String, to: 2, in: statement)
        bind(message["content"] as? String, to: 3, in: statement)
        bind(message["intent"] as? String, to: 4, in: statement)
        bind(message["createdAt"] as? String, to: 5, in: statement)
        guard sqlite3_step(statement) == SQLITE_DONE else { throw storageError() }
    }

    private func readMessages() throws -> [[String: Any]] {
        guard let db else { throw storageError() }
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, "SELECT id, role, content, intent, created_at FROM messages ORDER BY created_at, rowid;", -1, &statement, nil) == SQLITE_OK else { throw storageError() }
        defer { sqlite3_finalize(statement) }
        var rows: [[String: Any]] = []
        while sqlite3_step(statement) == SQLITE_ROW {
            func value(_ column: Int32) -> String { guard let text = sqlite3_column_text(statement, column) else { return "" }; return String(cString: text) }
            var row: [String: Any] = ["id": value(0), "role": value(1), "content": value(2), "createdAt": value(4)]
            if sqlite3_column_type(statement, 3) != SQLITE_NULL { row["intent"] = value(3) }
            rows.append(row)
        }
        return rows
    }

    private func bind(_ value: String?, to index: Int32, in statement: OpaquePointer?) {
        if let value { sqlite3_bind_text(statement, index, (value as NSString).utf8String, -1, SQLITE_TRANSIENT) }
        else { sqlite3_bind_null(statement, index) }
    }

    private func makeMessage(role: String, content: String, intent: String? = nil) -> [String: Any] {
        var result: [String: Any] = ["id": UUID().uuidString, "role": role, "content": content, "createdAt": ISO8601DateFormatter().string(from: Date())]
        if let intent { result["intent"] = intent }
        return result
    }

    private func storageError() -> NSError { NSError(domain: "LocalChatStorage", code: 1, userInfo: [NSLocalizedDescriptionKey: "SQLite operation failed"]) }
}

private struct IntentAnalyzer {
    private static let responses: [String: String] = [
        "REASSURE": "ㄱㅊ아", "COMFORT": "아현 걱정하지마", "ENCOURAGE": "아현 잘할수있어",
        "AFFIRMATIVE": "웅",
        "REACTION": "이애가 진짜", "DENY": "그런거 아니야", "NO": "안돼",
        "SURPRISE": "ㅇㄹㅅㄱ", "CUTE": "ㄱㅇㅇ", "ASK_WHAT_HAPPENED": "아현 무슨일이야",
        "SIGH": "ㅇㅎ", "AFFECTION": "오구"
    ]

    static var isModelAvailable: Bool {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            let model = SystemLanguageModel.default
            return model.isAvailable && model.supportsLocale(Locale(identifier: "ko-KR"))
        }
        #endif
        return false
    }

    func verifyModelConnection() async -> Bool {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *), SystemLanguageModel.default.isAvailable,
           SystemLanguageModel.default.supportsLocale(Locale(identifier: "ko-KR")) {
            return await classifyWithAppleModel("안녕하세요") != nil
        }
        #endif
        return false
    }

    func answer(for input: String) async -> (String, String) {
        if input.range(of: #"(^|\s)졸($|\s)"#, options: .regularExpression) != nil {
            return ("AFFECTION", Self.responses["AFFECTION"]!)
        }
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *), SystemLanguageModel.default.isAvailable,
           SystemLanguageModel.default.supportsLocale(Locale(identifier: "ko-KR")),
           let result = await classifyWithAppleModel(input) {
            return (result, Self.responses[result]!)
        }
        #endif
        return ruleBasedAnswer(for: input)
    }

    #if canImport(FoundationModels)
    @available(iOS 26.0, *)
    private func classifyWithAppleModel(_ input: String) async -> String? {
        let labels = Self.responses.keys.sorted().joined(separator: ", ")
        let guidance = loadModelGuidance()
        let session = LanguageModelSession(instructions: """
        다음은 앱의 목적과 사용자의 감정을 분류하는 지침이다. 메시지 분류에 반드시 적용한다.
        --- 지침 시작 ---
        \(guidance)
        --- 지침 끝 ---

        사용자의 한국어 메시지 의도만 분류한다.
        다음 허용 코드 중 하나만 정확히 출력한다: \(labels)
        다른 설명, 문장, 기호는 출력하지 않는다.
        """)
        do {
            let response = try await session.respond(to: "메시지: \(input)")
            let label = response.content.trimmingCharacters(in: .whitespacesAndNewlines)
                .uppercased().trimmingCharacters(in: CharacterSet(charactersIn: ".!,:;`\"'"))
            return Self.responses[label] == nil ? nil : label
        } catch { return nil }
    }

    private func loadModelGuidance() -> String {
        guard let url = Bundle.main.url(forResource: "on-device-model-guidance", withExtension: "md"),
              let content = try? String(contentsOf: url, encoding: .utf8) else {
            return "사용자가 당황하거나 불안해하면 놀리거나 장난스럽게 반응하지 말고 COMFORT 또는 REASSURE를 우선한다. 가벼운 반응 REACTION을 불안, 두려움, 곤란함의 기본값으로 사용하지 않는다. 허용된 의도 코드 하나만 출력한다."
        }
        return content
    }
    #endif

    private func ruleBasedAnswer(for input: String) -> (String, String) {
        let text = input.lowercased()
        let normalized = text.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: .punctuationCharacters)
        if ["웅", "응", "네", "넵", "넹", "ㅇㅇ", "ㅇㅋ", "그래", "맞아", "좋아", "오케이", "알겠어"].contains(normalized) {
            return ("AFFIRMATIVE", "웅")
        }
        if ["걱정하지", "괜찮을 거야", "괜찮을거야"].contains(where: text.contains) {
            return ("COMFORT", "아현 걱정하지마")
        }
        if ["걱정", "불안", "무서", "힘들", "괜찮", "속상"].contains(where: text.contains) {
            return ("REASSURE", "ㄱㅊ아")
        }
        if ["할 수", "할수", "포기", "실패", "시험", "도전", "못하"].contains(where: text.contains) {
            return ("ENCOURAGE", "아현 잘할수있어")
        }
        if ["무슨 일", "무슨일", "왜 그래", "왜그래", "무슨 일이", "힘든 일"].contains(where: text.contains) {
            return ("ASK_WHAT_HAPPENED", "아현 무슨일이야")
        }
        if ["아니야", "아닌데", "오해", "그런 거", "그런거"].contains(where: text.contains) {
            return ("DENY", "그런거 아니야")
        }
        if ["안돼", "안 돼", "하지 마", "싫어", "그만"].contains(where: text.contains) {
            return ("NO", "안돼")
        }
        if ["진짜", "대박", "헐", "믿을 수", "설마"].contains(where: text.contains) {
            return ("SURPRISE", "ㅇㄹㅅㄱ")
        }
        if ["귀여", "예쁘", "사랑스러", "깜찍"].contains(where: text.contains) {
            return ("CUTE", "ㄱㅇㅇ")
        }
        if ["에휴", "하아", "한숨", "피곤", "지친"].contains(where: text.contains) {
            return ("SIGH", "ㅇㅎ")
        }
        let containsSleepFragment = text.range(of: #"(^|\s)졸($|\s)"#, options: .regularExpression) != nil
        if containsSleepFragment || ["졸리", "졸려", "잠 와", "잠와", "자고 싶", "오구", "아이고", "아가", "울어", "울지"].contains(where: text.contains) {
            return ("AFFECTION", "오구")
        }
        if ["뭐야", "정말이야", "어떡", "어쩌지", "무슨"].contains(where: text.contains) {
            return ("REACTION", "이애가 진짜")
        }
        if ["안녕", "하이", "반가워", "hello", "hi", "고마워", "감사", "thanks", "thank you", "도움", "어떻게", "기능", "help", "잘 가", "안녕히", "종료", "bye"].contains(where: text.contains) {
            return ("REACTION", "아현 걱정하지마")
        }
        return ("REACTION", "이애가 진짜")
    }
}

private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

