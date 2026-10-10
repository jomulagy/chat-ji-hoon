import { useEffect, useRef, useState, type FormEvent } from 'react';
import { getGeminiProxySettings, isNativeRuntime, LocalChat, saveGeminiProxySettings, type ChatMessage } from './localChat';
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
  const [runtimeMessage, setRuntimeMessage] = useState('Gemini Worker 연결 설정이 필요합니다');
  const [error, setError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [proxyUrl, setProxyUrl] = useState(() => getGeminiProxySettings().url);
  const [proxyToken, setProxyToken] = useState(() => getGeminiProxySettings().token);
  const [settingsError, setSettingsError] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
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

  async function saveProxySettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingSettings(true);
    setSettingsError('');
    try {
      await saveGeminiProxySettings(proxyUrl, proxyToken);
      const status = await LocalChat.getRuntimeStatus();
      setRuntimeMessage(status.message);
      if (status.modelReady) setSettingsOpen(false);
      else setSettingsError(status.message);
    } catch (e) {
      setSettingsError(e instanceof Error ? e.message : '연결 설정을 저장하지 못했습니다.');
    } finally {
      setSavingSettings(false);
    }
  }

  if (booting) return <main className="splash" aria-busy="true" aria-live="polite">
    <div className="splash-content">
      <div className="splash-mark" aria-hidden="true"><span>✳</span><i /><i /><i /></div>
      <h1>CHAT 지훈띠</h1>
      <p>{isNativeRuntime ? '온디바이스 AI 연결을 확인하고 있어요' : 'Gemini AI 연결을 확인하고 있어요'}</p>
      <div className="loading-track" role="progressbar" aria-label="앱 준비 중"><span /></div>
      <span className="splash-caption">{isNativeRuntime ? '대화와 분석은 이 기기에서 처리됩니다' : '메시지를 안전한 연결을 통해 AI에 전달합니다'}</span>
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
    <header><div><h1>CHAT 지훈띠</h1></div><div className="header-actions"><button className="clear" onClick={() => setSettingsOpen(true)} aria-label="AI 연결 설정">AI 설정</button><button className="clear" onClick={() => void clear()} disabled={replying || waitingForTurn || messages.length === 0}>기록 지우기</button></div></header>
    <section ref={conversation} className="conversation" aria-live="polite">
      {messages.length === 0 ? <div className="empty"><div className="spark">✳</div><h2>아현 무슨일이야</h2><p>{isNativeRuntime ? '메시지를 보내면 기기 안에서 내용을 분석해 답변합니다.' : '메시지를 보내면 Gemini AI가 내용을 분석해 답변합니다.'}</p></div> : messages.map((m, index) => {
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
    {settingsOpen && !isNativeRuntime && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
      <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <button className="modal-close" onClick={() => setSettingsOpen(false)} aria-label="닫기">×</button>
        <h2 id="settings-title">Gemini AI 연결</h2>
        <p>Cloudflare Worker 주소와 Worker 접속 코드를 입력하세요. API 키는 앱에 저장하지 않습니다.</p>
        <form onSubmit={(event) => void saveProxySettings(event)}>
          <label>Worker 주소<input type="url" value={proxyUrl} onChange={(event) => setProxyUrl(event.target.value)} placeholder="https://chat-jihun-api.example.workers.dev" required /></label>
          <label>Worker 접속 코드<input type="password" value={proxyToken} onChange={(event) => setProxyToken(event.target.value)} placeholder="Cloudflare에 설정한 APP_ACCESS_TOKEN" autoComplete="off" required /></label>
          {settingsError && <div className="error" role="alert">{settingsError}</div>}
          <button className="save-settings" type="submit" disabled={savingSettings}>{savingSettings ? '연결 확인 중…' : '저장하고 연결 확인'}</button>
        </form>
        <p className="privacy-note">입력한 대화는 Gemini API로 전송됩니다. 앱에는 Worker 주소와 접속 코드만 저장됩니다.</p>
      </section>
    </div>}
  </main>;
}
