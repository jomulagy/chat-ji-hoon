import { useEffect, useRef, useState } from 'react';
import { LocalChat, type ChatMessage } from './localChat';
import './style.css';

function isSameMinute(first: string, second: string) {
  const a = new Date(first);
  const b = new Date(second);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate() && a.getHours() === b.getHours() && a.getMinutes() === b.getMinutes();
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
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

  useEffect(() => {
    let active = true;
    async function initialize() {
      const [historyResult, runtimeResult] = await Promise.allSettled([
        LocalChat.getMessages(),
        LocalChat.getRuntimeStatus(),
        new Promise((resolve) => window.setTimeout(resolve, 800)),
      ]);
      if (!active) return;
      if (runtimeResult.status === 'fulfilled') setRuntimeMessage(runtimeResult.value.message);
      if (historyResult.status === 'fulfilled') setMessages(historyResult.value.messages);
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

  async function clear() {
    if (replyTimer.current !== null) window.clearTimeout(replyTimer.current);
    replyTimer.current = null;
    pendingFragments.current = [];
    try { await LocalChat.clearMessages(); setMessages([]); setError(''); }
    catch { setError('대화 기록을 초기화하지 못했습니다. 저장 서버 연결을 확인해 주세요.'); }
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

  return <main className="shell">
    <header><div><h1>CHAT 지훈띠</h1></div><button className="clear" onClick={() => void clear()} disabled={replying || waitingForTurn || messages.length === 0}>기록 지우기</button></header>
    <section ref={conversation} className="conversation" aria-live="polite">
      {messages.length === 0 ? <div className="empty"><div className="spark">✳</div><h2>아현 무슨일이야</h2><p>메시지를 보내면 Gemini AI가 내용을 분석해 답변합니다.</p></div> : messages.map((m, index) => {
        const next = messages[index + 1];
        const showTime = m.role !== 'user' || !next || next.role !== 'user' || !isSameMinute(m.createdAt, next.createdAt);
        return <article key={m.id} className={`message ${m.role}`}><div className="bubble">{m.content}</div>{showTime && <time>{new Date(m.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</time>}</article>;
      })}
      {waitingForTurn && !replying && <div className="thinking">말을 이어서 보내세요 · 마지막 메시지 후 3초 뒤 답변<span>•••</span></div>}
      {replying && <div className="thinking">말씀을 모아서 답변을 만들고 있어요<span>•••</span></div>}
    </section>
    {error && <div className="error" role="alert">{error}</div>}
    <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(); }}><input value={text} onChange={(e) => setText(e.target.value)} placeholder="메시지를 입력하세요" aria-label="메시지" maxLength={2000} /><button type="submit" disabled={!text.trim()} aria-label="전송">↑</button></form>
    <footer>{runtimeMessage}</footer>
  </main>;
}
