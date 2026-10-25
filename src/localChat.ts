export type ChatMessage = {
  id: string;
  role: 'user' | 'service';
  content: string;
  intent?: string;
  createdAt: string;
};

export type ChatDiagnostic = {
  id: string;
  event: string;
  requestId?: string;
  code: string;
  message: string;
  httpStatus?: number;
  elapsedMs?: number;
  client: string;
  online: boolean;
  createdAt: string;
};

export type ChatDiagnosticInput = Omit<ChatDiagnostic, 'id' | 'client' | 'online' | 'createdAt'>;

export interface LocalChatPlugin {
  appendUserMessage(options: { text: string }): Promise<{ userMessage: ChatMessage }>;
  generateReply(options: { text: string; requestId: string }): Promise<{ serviceMessage: ChatMessage }>;
  getMessages(): Promise<{ messages: ChatMessage[] }>;
  getDiagnostics(): Promise<{ diagnostics: ChatDiagnostic[] }>;
  recordDiagnostic(input: ChatDiagnosticInput): Promise<void>;
  clearMessages(): Promise<void>;
  getRuntimeStatus(): Promise<{ ready: boolean; modelReady: boolean; message: string }>;
}

const configuredWorkerUrl = import.meta.env.VITE_GEMINI_WORKER_URL?.trim().replace(/\/+$/u, '') ?? '';
const allowedReplies: Record<string, string> = {
  GREETING: '안녕', ASK_JIHOON: '지훈이한테 물어봐',
  AFFIRMATIVE: '웅', FOOD_INVITE: '먹으러 가자', FOOD_ACCEPT: '좋아', OFFER_RIDE: '차 태워줄게', JOB_CHANGE: '이직하자',
  ACKNOWLEDGE: '알았어', APOLOGY: '미안해', COMFORT: '아현 걱정하지마',
  REASSURE: 'ㄱㅊ아', CHECK_IN: '아현 괜찮아?', ENCOURAGE: '아현 잘할수있어',
  ASK_WHAT_HAPPENED: '아현 무슨일이야', DENY: '그런거 아니야', NO: '안돼', SURPRISE: 'ㅇㄹㅅㄱ',
  CUTE: 'ㄱㅇㅇ', SIGH: 'ㅇㅎ', AFFECTION: '오구', LOVE_BACK: '나도 사랑해', REACTION: '이애가 진짜',
};

function workerEndpoint(path: '/health' | '/reply') {
  // Local dev and preview use Vite's same-origin proxy. It reads .dev.vars on the server,
  // so the local access token never enters browser code or localStorage.
  return configuredWorkerUrl ? `${configuredWorkerUrl}${path}` : `/api${path}`;
}
function historyEndpoint() {
  return configuredWorkerUrl ? `${configuredWorkerUrl}/messages` : '/api/messages';
}
function diagnosticEndpoint() {
  return configuredWorkerUrl ? `${configuredWorkerUrl}/diagnostics` : '/api/diagnostics';
}

function getClientFamily() {
  const agent = navigator.userAgent;
  if (/iPhone|iPad|iPod/iu.test(agent)) return /Safari/iu.test(agent) && !/CriOS|FxiOS|EdgiOS/iu.test(agent) ? 'ios-safari' : 'ios-other';
  if (/Android/iu.test(agent)) return 'android';
  return 'desktop';
}

const LOCAL_DIAGNOSTICS_KEY = 'chat-jihun-local-diagnostics';

function getLocalDiagnostics(): ChatDiagnostic[] {
  try {
    const entries = JSON.parse(window.localStorage.getItem(LOCAL_DIAGNOSTICS_KEY) ?? '[]');
    return Array.isArray(entries) ? entries as ChatDiagnostic[] : [];
  } catch { return []; }
}

function saveLocalDiagnostic(entry: ChatDiagnostic) {
  try {
    const entries = getLocalDiagnostics().filter((item) => item.id !== entry.id);
    window.localStorage.setItem(LOCAL_DIAGNOSTICS_KEY, JSON.stringify([entry, ...entries].slice(0, 100)));
  } catch { /* Private browsing may disable local storage; console logging remains available. */ }
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('요청 시간이 초과되었습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.');
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

async function saveMessage(message: ChatMessage) {
  const response = await fetchWithTimeout(historyEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  });
  if (!response.ok) throw new Error('채팅 기록을 저장하지 못했습니다. 저장 서버 연결을 확인해 주세요.');
}

async function getBrowserMessages() {
  const response = await fetchWithTimeout(historyEndpoint());
  if (!response.ok) throw new Error('대화 기록을 불러오지 못했습니다. 저장 서버 연결을 확인해 주세요.');
  const payload = await response.json() as { messages?: ChatMessage[] };
  return payload.messages ?? [];
}

async function getBrowserDiagnostics() {
  let remote: ChatDiagnostic[] = [];
  try {
    const response = await fetchWithTimeout(diagnosticEndpoint());
    if (!response.ok) throw new Error('답변 오류 기록을 불러오지 못했습니다.');
    const payload = await response.json() as { diagnostics?: ChatDiagnostic[] };
    remote = payload.diagnostics ?? [];
  } catch { /* Keep local failure records visible if the Worker cannot be reached. */ }
  const merged = new Map<string, ChatDiagnostic>();
  for (const entry of [...getLocalDiagnostics(), ...remote]) merged.set(entry.id, entry);
  return [...merged.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 200);
}

async function recordBrowserDiagnostic(input: ChatDiagnosticInput) {
  const entry: ChatDiagnostic = {
    ...input,
    id: crypto.randomUUID(),
    client: getClientFamily(),
    online: navigator.onLine,
    createdAt: new Date().toISOString(),
  };
  try {
    const response = await fetchWithTimeout(diagnosticEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
      keepalive: true,
    }, 3000);
    if (!response.ok) throw new Error(`로그 저장 실패 (${response.status})`);
  } catch (error) {
    // If the Worker itself is unreachable, preserve a clue in the browser console.
    saveLocalDiagnostic(entry);
    console.error('[CHAT_DIAGNOSTIC] 로그 서버 전송 실패', { ...entry, error });
  }
}

async function clearBrowserMessages() {
  const response = await fetchWithTimeout(historyEndpoint(), { method: 'DELETE' });
  if (!response.ok) throw new Error('대화 기록을 초기화하지 못했습니다.');
}

const browserChat: LocalChatPlugin = {
  async appendUserMessage({ text }) {
    const now = new Date().toISOString();
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: text, createdAt: now };
    await saveMessage(userMessage);
    return { userMessage };
  },
  async generateReply({ text, requestId }) {
    const startedAt = Date.now();
    void recordBrowserDiagnostic({ event: 'reply_started', requestId, code: 'request_started', message: '답변 요청을 시작했습니다.' });
    let response: Response;
    try {
      response = await fetchWithTimeout(workerEndpoint('/reply'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, requestId }),
      }, 25000);
    } catch (error) {
      // The Worker may have persisted the reply just before the browser timed out.
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const saved = await getBrowserMessages().catch(() => []);
        const savedReply = saved.find((message) => message.id === `service:${requestId}`);
        if (savedReply) {
          void recordBrowserDiagnostic({ event: 'reply_recovered', requestId, code: 'saved_reply_after_request_error', message: '요청 응답은 실패했지만 서버 기록에서 저장된 답변을 찾았습니다.', elapsedMs: Date.now() - startedAt });
          return { serviceMessage: savedReply };
        }
        if (attempt < 3) await new Promise<void>((resolve) => window.setTimeout(resolve, 500));
      }
      void recordBrowserDiagnostic({
        event: 'reply_failed', requestId,
        code: error instanceof Error && error.message.includes('시간이 초과') ? 'request_timeout' : 'network_error',
        message: error instanceof Error ? error.message : String(error),
        elapsedMs: Date.now() - startedAt,
      });
      throw error;
    }
    const payload = await response.json().catch(() => ({})) as {
      intent?: string; content?: string; error?: string; serviceMessage?: ChatMessage;
    };
    if (!response.ok) {
      void recordBrowserDiagnostic({ event: 'reply_failed', requestId, code: 'worker_http_error', message: payload.error ?? `AI 요청 실패 (${response.status})`, httpStatus: response.status, elapsedMs: Date.now() - startedAt });
      throw new Error(payload.error ?? `AI 요청 실패 (${response.status})`);
    }
    if (typeof payload.intent !== 'string' || !Object.hasOwn(allowedReplies, payload.intent)) {
      void recordBrowserDiagnostic({ event: 'reply_failed', requestId, code: 'invalid_worker_response', message: 'AI 서버가 허용된 의도를 반환하지 않았습니다.', httpStatus: response.status, elapsedMs: Date.now() - startedAt });
      throw new Error('AI 서버가 허용된 의도를 반환하지 않았습니다.');
    }
    const serviceMessage = payload.serviceMessage?.id === `service:${requestId}` && payload.serviceMessage.role === 'service'
      ? payload.serviceMessage
      : {
          id: `service:${requestId}`, role: 'service' as const, content: allowedReplies[payload.intent],
          intent: payload.intent, createdAt: new Date().toISOString(),
        };
    // Compatibility with a Worker version that still returns intent/content only.
    if (!payload.serviceMessage) {
      try { await saveMessage(serviceMessage); }
      catch (error) {
        void recordBrowserDiagnostic({ event: 'reply_failed', requestId, code: 'reply_save_failed', message: error instanceof Error ? error.message : String(error), elapsedMs: Date.now() - startedAt });
        throw error;
      }
    }
    void recordBrowserDiagnostic({ event: 'reply_succeeded', requestId, code: 'reply_received', message: '답변을 받아 화면에 반영했습니다.', elapsedMs: Date.now() - startedAt });
    return { serviceMessage };
  },
  async getMessages() { return { messages: await getBrowserMessages() }; },
  async getDiagnostics() { return { diagnostics: await getBrowserDiagnostics() }; },
  async recordDiagnostic(input) { await recordBrowserDiagnostic(input); },
  async clearMessages() { await clearBrowserMessages(); },
  async getRuntimeStatus() {
    try {
      const response = await fetchWithTimeout(workerEndpoint('/health'), {}, 8000);
      if (!response.ok) {
        void recordBrowserDiagnostic({ event: 'worker_health_failed', code: 'health_http_error', message: 'Gemini Worker 연결 확인에 실패했습니다.', httpStatus: response.status });
        return { ready: true, modelReady: false, message: `Gemini Worker 연결 확인 실패 (${response.status})` };
      }
      const payload = await response.json() as { ready?: boolean };
      if (!payload.ready) return { ready: true, modelReady: false, message: 'Gemini API 키가 Worker에 설정되지 않았습니다' };
      return { ready: true, modelReady: true, message: `Gemini API 연결됨 · ${configuredWorkerUrl ? '클라우드 Worker' : '로컬 Worker'} 사용 중` };
    } catch {
      void recordBrowserDiagnostic({ event: 'worker_health_failed', code: 'health_network_error', message: 'Gemini Worker에 연결할 수 없습니다.' });
      return { ready: true, modelReady: false, message: 'Gemini Worker에 연결할 수 없습니다. Worker 실행 상태를 확인해 주세요.' };
    }
  },
};

export const LocalChat = browserChat;
