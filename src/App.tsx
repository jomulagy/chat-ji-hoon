import { useEffect, useRef, useState } from 'react';
import { isNativeRuntime, LocalChat, type ChatMessage } from './localChat';
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
  const [startupError, setStartupError] = useState('');
  const [runtimeMessage, setRuntimeMessage] = useState('브라우저 AI 모델을 준비하고 있어요');
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
      if (isNativeRuntime && (runtimeResult.status !== 'fulfilled' || !runtimeResult.value.modelReady)) {
        setStartupError('온디바이스 AI 모델을 사용할 수 없어 앱을 시작할 수 없습니다. 지원되는 iPhone과 iOS 버전, Apple Intelligence 및 한국어 모델 설정을 확인해 주세요. 앱을 닫으려면 화면 아래에서 위로 쓸어 올려 앱 전환 화면을 연 뒤 CHAT 지훈띠를 위로 쓸어 올리세요.');
      }
      if (!isNativeRuntime && runtimeResult.status === 'fulfilled') setRuntimeMessage(runtimeResult.value.message);
      if (historyResult.status === 'fulfilled') setMessages(historyResult.value.messages);
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
    }, 5000);
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
    catch { setError('대화 기록을 초기화하지 못했습니다. iPhone 앱에서 다시 시도해 주세요.'); }
  }

  if (booting) return <main className="splash" aria-busy="true" aria-live="polite">
    <div className="splash-content">
      <div className="splash-mark" aria-hidden="true"><span>✳</span><i /><i /><i /></div>
      <h1>CHAT 지훈띠</h1>
      <p>{isNativeRuntime ? '온디바이스 AI 연결을 확인하고 있어요' : '브라우저 AI 모델을 준비하고 있어요'}</p>
      <div className="loading-track" role="progressbar" aria-label="앱 준비 중"><span /></div>
      <span className="splash-caption">대화와 분석은 이 기기에서 처리됩니다</span>
    </div>
  </main>;

  if (startupError) return <main className="splash launch-error" role="alert">
    <div className="splash-content">
      <div className="splash-mark error-mark" aria-hidden="true">!</div>
      <h1>AI 모델 연결 오류</h1>
      <p>{startupError}</p>
    </div>
  </main>;

  return <main className="shell">
    <header><div><h1>CHAT 지훈띠</h1></div><button className="clear" onClick={() => void clear()} disabled={replying || waitingForTurn || messages.length === 0}>기록 지우기</button></header>
    <section ref={conversation} className="conversation" aria-live="polite">
      {messages.length === 0 ? <div className="empty"><div className="spark">✳</div><h2>아현 무슨일이야</h2><p>메시지를 보내면 기기 안에서 내용을 분석해 답변합니다.</p></div> : messages.map((m, index) => {
        const next = messages[index + 1];
        const showTime = m.role !== 'user' || !next || next.role !== 'user' || !isSameMinute(m.createdAt, next.createdAt);
        return <article key={m.id} className={`message ${m.role}`}><div className="bubble">{m.content}</div>{showTime && <time>{new Date(m.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</time>}</article>;
      })}
      {waitingForTurn && !replying && <div className="thinking">말을 이어서 보내세요 · 마지막 메시지 후 5초 뒤 답변<span>•••</span></div>}
      {replying && <div className="thinking">말씀을 모아서 답변을 만들고 있어요<span>•••</span></div>}
    </section>
    {error && <div className="error" role="alert">{error}</div>}
    <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(); }}><input value={text} onChange={(e) => setText(e.target.value)} placeholder="메시지를 입력하세요" aria-label="메시지" maxLength={2000} /><button type="submit" disabled={!text.trim()} aria-label="전송">↑</button></form>
    <footer>{isNativeRuntime ? '대화와 분석은 이 기기에서 처리됩니다' : runtimeMessage}</footer>
  </main>;
}
