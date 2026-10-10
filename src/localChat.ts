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
let browserModelReady = false;
let browserModelMessage = '브라우저 AI 모델을 불러오지 못해 규칙 기반으로 응답합니다.';

function readPreviewMessages(): ChatMessage[] {
  try { return JSON.parse(localStorage.getItem(storageKey) ?? '[]') as ChatMessage[]; }
  catch { return []; }
}

function classifyPreviewMessage(input: string): { intent: string; content: string } {
  const text = input.toLowerCase();
  const matches = (...terms: string[]) => terms.some((term) => text.includes(term));
  const normalized = text.trim().replace(/[.!?,~…]+$/u, '');
  if (['웅', '응', '네', '넵', '넹', 'ㅇㅇ', 'ㅇㅋ', '그래', '맞아', '좋아', '오케이', '알겠어'].includes(normalized)) return { intent: 'AFFIRMATIVE', content: '웅' };
  if (matches('걱정하지', '괜찮을 거야', '괜찮을거야')) return { intent: 'COMFORT', content: '아현 걱정하지마' };
  if (matches('걱정', '불안', '무서', '힘들', '괜찮', '속상')) return { intent: 'REASSURE', content: 'ㄱㅊ아' };
  if (matches('할 수', '할수', '포기', '실패', '시험', '도전', '못하')) return { intent: 'ENCOURAGE', content: '아현 잘할수있어' };
  if (matches('무슨 일', '무슨일', '왜 그래', '왜그래', '힘든 일')) return { intent: 'ASK_WHAT_HAPPENED', content: '아현 무슨일이야' };
  if (matches('아니야', '아닌데', '오해', '그런 거', '그런거')) return { intent: 'DENY', content: '그런거 아니야' };
  if (matches('안돼', '안 돼', '하지 마', '싫어', '그만')) return { intent: 'NO', content: '안돼' };
  if (matches('진짜', '대박', '헐', '믿을 수', '설마')) return { intent: 'SURPRISE', content: 'ㅇㄹㅅㄱ' };
  if (matches('귀여', '예쁘', '사랑스러', '깜찍')) return { intent: 'CUTE', content: 'ㄱㅇㅇ' };
  if (matches('에휴', '하아', '한숨', '피곤', '지친')) return { intent: 'SIGH', content: 'ㅇㅎ' };
  if (/(^|\s)졸($|\s)/u.test(text) || matches('졸리', '졸려', '잠 와', '잠와', '자고 싶', '오구', '아이고', '아가', '울어', '울지')) return { intent: 'AFFECTION', content: '오구' };
  if (matches('안녕', '하이', '반가워', 'hello', 'hi', '고마워', '감사', 'thanks', 'thank you', '도움', '어떻게', '기능', 'help', '잘 가', '안녕히', '종료', 'bye')) return { intent: 'REACTION', content: '아현 걱정하지마' };
  return { intent: 'REACTION', content: '이애가 진짜' };
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
    let result: { intent: string; content: string };
    try {
      const { classifyInBrowser } = await import('./browserIntentModel');
      const intent = await classifyInBrowser(text);
      result = { intent: intent.intent, content: intent.content };
    } catch (error) {
      console.warn('Browser AI model failed; using local rules instead.', error);
      result = classifyPreviewMessage(text);
      browserModelReady = false;
      browserModelMessage = '브라우저 AI 연결 실패 · 규칙 기반 응답';
    }
    const serviceMessage: ChatMessage = { id: crypto.randomUUID(), role: 'service', content: result.content, intent: result.intent, createdAt: new Date().toISOString() };
    localStorage.setItem(storageKey, JSON.stringify([...readPreviewMessages(), serviceMessage]));
    return { serviceMessage };
  },
  async getMessages() { return { messages: readPreviewMessages() }; },
  async clearMessages() { localStorage.removeItem(storageKey); },
  async getRuntimeStatus() {
    try {
      const { warmBrowserIntentModel } = await import('./browserIntentModel');
      await warmBrowserIntentModel();
      browserModelReady = true;
      browserModelMessage = '브라우저 AI 연결됨 · 입력 분석은 이 기기에서 처리됩니다';
    } catch (error) {
      console.warn('Browser AI model could not be loaded; using local rules instead.', error);
      browserModelReady = false;
      browserModelMessage = '브라우저 AI 연결 실패 · 규칙 기반 응답';
    }
    return { ready: true, modelReady: browserModelReady, message: browserModelMessage };
  },
};

export const isNativeRuntime = Capacitor.isNativePlatform();
export const LocalChat = isNativeRuntime ? nativeChat : browserPreview;
