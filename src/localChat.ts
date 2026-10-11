export type ChatMessage = {
  id: string;
  role: 'user' | 'service';
  content: string;
  intent?: string;
  createdAt: string;
};

export interface LocalChatPlugin {
  appendUserMessage(options: { text: string }): Promise<{ userMessage: ChatMessage }>;
  generateReply(options: { text: string }): Promise<{ serviceMessage: ChatMessage }>;
  getMessages(): Promise<{ messages: ChatMessage[] }>;
  clearMessages(): Promise<void>;
  getRuntimeStatus(): Promise<{ ready: boolean; modelReady: boolean; message: string }>;
}

const configuredWorkerUrl = import.meta.env.VITE_GEMINI_WORKER_URL?.trim().replace(/\/+$/u, '') ?? '';
const allowedReplies: Record<string, string> = {
  AFFIRMATIVE: '웅', COMFORT: '아현 걱정하지마', REASSURE: 'ㄱㅊ아', ENCOURAGE: '아현 잘할수있어',
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
  async generateReply({ text }) {
    const response = await fetchWithTimeout(workerEndpoint('/reply'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }, 25000);
    const payload = await response.json().catch(() => ({})) as { intent?: string; content?: string; error?: string };
    if (!response.ok) throw new Error(payload.error ?? `AI 요청 실패 (${response.status})`);
    if (typeof payload.intent !== 'string' || !Object.hasOwn(allowedReplies, payload.intent)) throw new Error('AI 서버가 허용된 의도를 반환하지 않았습니다.');
    const result = { intent: payload.intent, content: allowedReplies[payload.intent] };
    const serviceMessage: ChatMessage = { id: crypto.randomUUID(), role: 'service', content: result.content, intent: result.intent, createdAt: new Date().toISOString() };
    await saveMessage(serviceMessage);
    return { serviceMessage };
  },
  async getMessages() { return { messages: await getBrowserMessages() }; },
  async clearMessages() { await clearBrowserMessages(); },
  async getRuntimeStatus() {
    try {
      const response = await fetchWithTimeout(workerEndpoint('/health'), {}, 8000);
      if (!response.ok) return { ready: true, modelReady: false, message: `Gemini Worker 연결 확인 실패 (${response.status})` };
      const payload = await response.json() as { ready?: boolean };
      if (!payload.ready) return { ready: true, modelReady: false, message: 'Gemini API 키가 Worker에 설정되지 않았습니다' };
      return { ready: true, modelReady: true, message: `Gemini API 연결됨 · ${configuredWorkerUrl ? '클라우드 Worker' : '로컬 Worker'} 사용 중` };
    } catch {
      return { ready: true, modelReady: false, message: 'Gemini Worker에 연결할 수 없습니다. Worker 실행 상태를 확인해 주세요.' };
    }
  },
};

export const LocalChat = browserChat;
