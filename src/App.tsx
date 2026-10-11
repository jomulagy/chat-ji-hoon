import { useEffect, useRef, useState } from 'react';
import { LocalChat, type ChatMessage } from './localChat';
import './style.css';

const CHAT_CLEAR_CUTOFF_KEY = 'chat-jihun-cleared-through-message-id';

function isSameMinute(first: string, second: string) {
  const a = new Date(first);
  const b = new Date(second);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate() && a.getHours() === b.getHours() && a.getMinutes() === b.getMinutes();
}

function getAppBasePath() {
  const path = window.location.pathname.replace(/\/+$/u, '');
  return path.endsWith('/messages') ? path.slice(0, -'/messages'.length) : path;
}

export default function App() {
  const appBasePath = getAppBasePath();
  const messagesPage = window.location.pathname.replace(/\/+$/u, '').endsWith('/messages');
  const homeUrl = `${appBasePath || ''}/`;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatClearCutoff, setChatClearCutoff] = useState(() => window.localStorage.getItem(CHAT_CLEAR_CUTOFF_KEY) ?? '');
  const [text, setText] = useState('');
  const [replying, setReplying] = useState(false);
  const [waitingForTurn, setWaitingForTurn] = useState(false);
  const [booting, setBooting] = useState(true);
  const [runtimeMessage, setRuntimeMessage] = useState('Gemini Worker 연결을 확인하고 있어요');
  const [error, setError] = useState('');
  const conversation = useRef<HTMLElement>(null);
  const pendingFragments = useRef<string[]>([]);
  const replyTimer = useRef<number | null>(null);
  const replyingRef = useRef(false);
  const cutoffIndex = messages.findIndex((message) => message.id === chatClearCutoff);
  const chatMessages = cutoffIndex >= 0 ? messages.slice(cutoffIndex + 1) : messages;

  useEffect(() => {
    let active = true;
    async function initialize() {
      const historyPromise = LocalChat.getMessages().then(
        (value) => ({ ok: true as const, value }),
        (reason: unknown) => ({ ok: false as const, reason }),
      );
      const runtimePromise = messagesPage ? Promise.resolve(null) : LocalChat.getRuntimeStatus();
      const minimumSplash = messagesPage ? Promise.resolve() : new Promise<void>((resolve) => window.setTimeout(resolve, 800));
      const [historyResult, runtimeResult] = await Promise.all([historyPromise, runtimePromise, minimumSplash]);
      if (!active) return;
      if (runtimeResult) setRuntimeMessage(runtimeResult.message);
      if (historyResult.ok) setMessages(historyResult.value.messages);
      else setError(historyResult.reason instanceof Error ? historyResult.reason.message : '대화 기록을 불러오지 못했습니다.');
      setBooting(false);
    }
    void initialize();
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const element = conversation.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages, replying, waitingForTurn]);

  useEffect(() => () => {
    if (replyTimer.current !== null) window.clearTimeout(replyTimer.current);
  }, []);

  function scheduleReply() {
    if (replyTimer.current !== null) window.clearTimeout(replyTimer.current);
    setWaitingForTurn(true);
    replyTimer.current = window.setTimeout(() => {
      replyTimer.current = null;
      void flushReply();
    }, 3000);
  }

  async function flushReply() {
    if (replyingRef.current || pendingFragments.current.length === 0) return;
    const batch = pendingFragments.current.splice(0);
    replyingRef.current = true;
    setReplying(true);
    setWaitingForTurn(false);
    setError('');
    let failed = false;
    try {
      const { serviceMessage } = await LocalChat.generateReply({ text: batch.join('\n') });
      setMessages((items) => [...items, serviceMessage]);
    } catch (e) {
      failed = true;
      pendingFragments.current.unshift(...batch);
      setError(e instanceof Error ? e.message : '답변을 만들지 못했습니다. 메시지를 다시 보내 주세요.');
      setWaitingForTurn(true);
    } finally {
      replyingRef.current = false;
      setReplying(false);
      if (pendingFragments.current.length > 0 && !failed) scheduleReply();
    }
  }

  async function send() {
    const value = text.trim();
    if (!value) return;
    setText(''); setError('');
    try {
      const { userMessage } = await LocalChat.appendUserMessage({ text: value });
      setMessages((items) => [...items, userMessage]);
      pendingFragments.current.push(value);
      scheduleReply();
    } catch (e) {
      setError(e instanceof Error ? e.message : '메시지를 처리하지 못했습니다.');
      setText(value);
    }
  }

  function clear() {
    if (replyTimer.current !== null) window.clearTimeout(replyTimer.current);
    replyTimer.current = null;
    pendingFragments.current = [];
    const lastMessageId = messages.at(-1)?.id;
    if (lastMessageId) {
      window.localStorage.setItem(CHAT_CLEAR_CUTOFF_KEY, lastMessageId);
      setChatClearCutoff(lastMessageId);
    }
    setError('');
  }

  if (booting) return <main className="splash" aria-busy="true" aria-live="polite">
    <div className="splash-content">
      <div className="splash-mark" aria-hidden="true"><span>✳</span><i /><i /><i /></div>
      <h1>CHAT 지훈띠</h1>
      <p>Gemini AI 연결을 확인하고 있어요</p>
      <div className="loading-track" role="progressbar" aria-label="앱 준비 중"><span /></div>
      <span className="splash-caption">메시지를 안전한 연결을 통해 AI에 전달합니다</span>
    </div>
  </main>;

  if (messagesPage) return <main className="shell history-shell">
    <header><div><h1>CHAT 지훈띠</h1><p>서버 대화 기록</p></div><a className="clear" href={homeUrl}>채팅으로</a></header>
    <section className="conversation history-conversation" aria-live="polite">
      {error ? <div className="error" role="alert">{error}</div> : messages.length === 0 ? <div className="empty"><div className="spark">✳</div><h2>저장된 기록이 없어요</h2><p>대화 기록이 여기에 표시됩니다.</p></div> : messages.map((m, index) => {
        const previous = messages[index - 1];
        const next = messages[index + 1];
        const joinsPrevious = m.role === 'user' && previous?.role === 'user';
        const joinsNext = m.role === 'user' && next?.role === 'user';
        return <article key={m.id} className={`message ${m.role}${joinsPrevious ? ' fragment-previous' : ''}${joinsNext ? ' fragment-next' : ''}`}><div className="bubble">{m.content}</div><time>{new Date(m.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</time></article>;
      })}
    </section>
    <footer><button className="clear" onClick={() => window.location.reload()}>새로고침</button> · {messages.length}개 메시지</footer>
  </main>;

  return <main className="shell">
    <header><div><h1>CHAT 지훈띠</h1></div><nav className="header-actions"><button className="clear" onClick={clear} disabled={replying || waitingForTurn || chatMessages.length === 0}>채팅창 비우기</button></nav></header>
    <section ref={conversation} className="conversation" aria-live="polite">
      {chatMessages.length === 0 ? <div className="empty"><div className="spark">✳</div><h2>아현 무슨일이야</h2><p>메시지를 보내면 Gemini AI가 내용을 분석해 답변합니다.</p></div> : chatMessages.map((m, index) => {
        const next = chatMessages[index + 1];
        const previous = chatMessages[index - 1];
        const showTime = m.role !== 'user' || !next || next.role !== 'user' || !isSameMinute(m.createdAt, next.createdAt);
        const joinsPrevious = m.role === 'user' && previous?.role === 'user';
        const joinsNext = m.role === 'user' && next?.role === 'user';
        return <article key={m.id} className={`message ${m.role}${joinsPrevious ? ' fragment-previous' : ''}${joinsNext ? ' fragment-next' : ''}`}><div className="bubble">{m.content}</div>{showTime && <time>{new Date(m.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</time>}</article>;
      })}
      {waitingForTurn && !replying && <div className="thinking">말을 이어서 보내세요 · 마지막 메시지 후 3초 뒤 답변<span>•••</span></div>}
      {replying && <div className="thinking">말씀을 모아서 답변을 만들고 있어요<span>•••</span></div>}
    </section>
    {error && <div className="error" role="alert">{error}</div>}
    <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(); }}><input value={text} onChange={(e) => setText(e.target.value)} placeholder="메시지를 입력하세요" aria-label="메시지" maxLength={2000} /><button type="submit" disabled={!text.trim()} aria-label="전송">↑</button></form>
    <footer>{runtimeMessage}</footer>
  </main>;
}
