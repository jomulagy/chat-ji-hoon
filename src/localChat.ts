import { Capacitor, registerPlugin } from '@capacitor/core';

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

const nativeChat = registerPlugin<LocalChatPlugin>('LocalChat');
const storageKey = 'chat-kim-jihun-preview-messages';
const proxyUrlKey = 'chat-kim-jihun-gemini-proxy-url';
const proxyTokenKey = 'chat-kim-jihun-gemini-proxy-token';
const allowedReplies: Record<string, string> = {
  AFFIRMATIVE: '웅', COMFORT: '아현 걱정하지마', REASSURE: 'ㄱㅊ아', ENCOURAGE: '아현 잘할수있어',
  ASK_WHAT_HAPPENED: '아현 무슨일이야', DENY: '그런거 아니야', NO: '안돼', SURPRISE: 'ㅇㄹㅅㄱ',
  CUTE: 'ㄱㅇㅇ', SIGH: 'ㅇㅎ', AFFECTION: '오구', REACTION: '이애가 진짜',
};

function readPreviewMessages(): ChatMessage[] {
  try { return JSON.parse(localStorage.getItem(storageKey) ?? '[]') as ChatMessage[]; }
  catch { return []; }
}

export function getGeminiProxySettings() {
  return {
    url: localStorage.getItem(proxyUrlKey) ?? '',
    token: localStorage.getItem(proxyTokenKey) ?? '',
  };
}

export async function saveGeminiProxySettings(url: string, token: string) {
  const normalizedUrl = url.trim().replace(/\/+$/u, '');
  if (normalizedUrl) {
    const parsed = new URL(normalizedUrl);
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
      throw new Error('Worker 주소는 HTTPS 주소를 입력해 주세요.');
    }
    localStorage.setItem(proxyUrlKey, normalizedUrl);
    localStorage.setItem(proxyTokenKey, token.trim());
  } else {
    localStorage.removeItem(proxyUrlKey);
    localStorage.removeItem(proxyTokenKey);
  }
}

const browserPreview: LocalChatPlugin = {
  async appendUserMessage({ text }) {
    const now = new Date().toISOString();
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: text, createdAt: now };
    const messages = [...readPreviewMessages(), userMessage];
    localStorage.setItem(storageKey, JSON.stringify(messages));
    return { userMessage };
  },
  async generateReply({ text }) {
    const { url, token } = getGeminiProxySettings();
    if (!url || !token) throw new Error('Gemini Worker 주소와 접속 코드를 설정에서 입력해 주세요.');
    const response = await fetch(`${url}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text }),
    });
    const payload = await response.json().catch(() => ({})) as { intent?: string; content?: string; error?: string };
    if (!response.ok) throw new Error(payload.error ?? `AI 요청 실패 (${response.status})`);
    if (typeof payload.intent !== 'string' || !Object.hasOwn(allowedReplies, payload.intent)) throw new Error('AI 서버가 허용된 의도를 반환하지 않았습니다.');
    const result = { intent: payload.intent, content: allowedReplies[payload.intent] };
    const serviceMessage: ChatMessage = { id: crypto.randomUUID(), role: 'service', content: result.content, intent: result.intent, createdAt: new Date().toISOString() };
    localStorage.setItem(storageKey, JSON.stringify([...readPreviewMessages(), serviceMessage]));
    return { serviceMessage };
  },
  async getMessages() { return { messages: readPreviewMessages() }; },
  async clearMessages() { localStorage.removeItem(storageKey); },
  async getRuntimeStatus() {
    const { url, token } = getGeminiProxySettings();
    if (!url || !token) return { ready: true, modelReady: false, message: 'Gemini Worker 연결 설정이 필요합니다' };
    try {
      const response = await fetch(`${url}/health`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) return { ready: true, modelReady: false, message: `Gemini Worker 연결 확인 실패 (${response.status})` };
      const payload = await response.json() as { ready?: boolean };
      if (!payload.ready) return { ready: true, modelReady: false, message: 'Gemini API 키가 Worker에 설정되지 않았습니다' };
      return { ready: true, modelReady: true, message: 'Gemini API 연결됨 · 메시지는 인터넷을 통해 처리됩니다' };
    } catch {
      return { ready: true, modelReady: false, message: 'Gemini Worker에 연결할 수 없습니다' };
    }
  },
};

export const isNativeRuntime = Capacitor.isNativePlatform();
export const LocalChat = isNativeRuntime ? nativeChat : browserPreview;
