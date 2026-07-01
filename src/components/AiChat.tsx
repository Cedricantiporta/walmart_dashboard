'use client';

import { useState, useRef, useEffect } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTIONS: { icon: string; label: string; fill?: string; prompt?: string }[] = [
  { icon: '🔎', label: 'Ask about a case ID', fill: 'Tell me about case ' },
  { icon: '🧾', label: 'Ask about an invoice', fill: 'Tell me about invoice ' },
  { icon: '📊', label: 'Recovered Jan–May', prompt: 'What was the total recovered from January to May 2026?' },
  { icon: '🏢', label: 'Ask about a client', fill: 'Tell me about client ' },
];

const SendIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="19" x2="12" y2="5"/>
    <polyline points="5 12 12 5 19 12"/>
  </svg>
);

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

function TypingDots() {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '8px 14px' }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: '#006FEE', display: 'inline-block', animation: `aichatBounce 1.2s ${i * 0.18}s infinite` }} />
      ))}
    </div>
  );
}

function renderText(text: string) {
  const lines = text.split('\n');
  return lines.map((line, li) => {
    const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    return (
      <span key={li}>
        {parts.map((part, pi) => {
          if (part.startsWith('**') && part.endsWith('**'))
            return <strong key={pi}>{part.slice(2, -2)}</strong>;
          if (part.startsWith('`') && part.endsWith('`'))
            return <code key={pi} style={{ background: 'rgba(0,0,0,0.08)', borderRadius: 4, padding: '1px 4px', fontFamily: 'monospace', fontSize: 11 }}>{part.slice(1, -1)}</code>;
          return <span key={pi}>{part}</span>;
        })}
        {li < lines.length - 1 && <br />}
      </span>
    );
  });
}

export default function AiChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [multiline, setMultiline] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 80);
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function send(overrideText?: string) {
    const text = (overrideText ?? input).trim();
    if (!text || loading) return;
    setInput('');
    setMultiline(false);
    if (inputRef.current) inputRef.current.style.height = '19px';
    setError('');
    const newMessages: Message[] = [...messages, { role: 'user', content: text }];
    setMessages(newMessages);
    setLoading(true);
    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: messages }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setMessages([...newMessages, { role: 'assistant', content: data.reply }]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to get response');
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  return (
    <>
      <style>{`
        @keyframes aichatBounce {
          0%,60%,100% { transform:translateY(0); opacity:0.4; }
          30% { transform:translateY(-5px); opacity:1; }
        }
        @keyframes aichatUp {
          from { opacity:0; transform:translateY(16px) scale(0.97); }
          to   { opacity:1; transform:translateY(0)    scale(1);    }
        }
        .ai-fab { transition: transform 0.15s, box-shadow 0.15s; }
        .ai-fab:hover { transform: scale(1.08) !important; box-shadow: 0 6px 30px rgba(120,40,200,0.4) !important; }
        .ai-send:hover:not(:disabled) { opacity: 0.82; }
        .ai-send:disabled { opacity: 0.35; cursor: not-allowed; }
        .ai-ta::-webkit-scrollbar { width: 0; height: 0; display: none; }
        .ai-ta { scrollbar-width: none; -ms-overflow-style: none; }
        .ai-chip { transition: background 0.12s, border-color 0.12s, transform 0.12s; }
        .ai-chip:hover { background: #f4f4f5 !important; border-color: #d4d4d8 !important; transform: translateY(-1px); }
        /* Liquid motion — off-center color layers rotate at different speeds & directions (looks random) */
        @keyframes aichatRot { to { transform: rotate(360deg); } }
        @keyframes aichatRotRev { to { transform: rotate(-360deg); } }
        .ai-orb { position: relative; overflow: hidden; }
        .ai-orb-base { position: absolute; inset: 0; background: linear-gradient(140deg, #006FEE 0%, #7828C8 52%, #F5A524 100%); }
        .ai-orb-blob { position: absolute; inset: -14%; filter: blur(7px); }
        .ai-orb-b1 { background: radial-gradient(circle at 32% 34%, #3b93ff 0%, rgba(59,147,255,0) 52%); animation: aichatRot 13s linear infinite; }
        .ai-orb-b2 { background: radial-gradient(circle at 70% 42%, #9b3fe6 0%, rgba(155,63,230,0) 52%); animation: aichatRotRev 17s linear infinite; }
        .ai-orb-b3 { background: radial-gradient(circle at 48% 72%, #ffb43d 0%, rgba(255,180,61,0) 54%); animation: aichatRot 21s linear infinite; }
        /* Subtle glass — much less shiny */
        .ai-orb-gloss {
          position: absolute; inset: 0; border-radius: 50%; pointer-events: none;
          background: radial-gradient(circle at 35% 30%, rgba(255,255,255,0.26), rgba(255,255,255,0) 44%);
        }
        .ai-orb-rim {
          position: absolute; inset: 0; border-radius: 50%; pointer-events: none;
          box-shadow: inset 0 -3px 7px rgba(0,0,0,0.2);
        }
        @media (max-width: 480px) {
          .ai-panel { right: 12px !important; left: 12px !important; width: auto !important; bottom: 80px !important; }
          .ai-fab { right: 16px !important; bottom: 20px !important; }
        }
      `}</style>

      {/* Floating orb — animated rotating gradient */}
      <button
        className="ai-fab ai-orb"
        onClick={() => setOpen(o => !o)}
        title="WFS AI"
        style={{
          position: 'fixed', bottom: 28, right: 28, zIndex: 1000,
          width: 52, height: 52, borderRadius: '50%', border: 'none',
          background: open ? '#18181b' : '#0a0f1c',
          color: '#fff', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 20px rgba(120,40,200,0.3)',
          outline: 'none',
        }}
      >
        {!open && (
          <>
            <span className="ai-orb-base" />
            <span className="ai-orb-blob ai-orb-b1" />
            <span className="ai-orb-blob ai-orb-b2" />
            <span className="ai-orb-blob ai-orb-b3" />
            <span className="ai-orb-gloss" />
            <span className="ai-orb-rim" />
          </>
        )}
        {open && <span style={{ position: 'relative', zIndex: 1, display: 'flex' }}><CloseIcon /></span>}
      </button>

      {/* Panel */}
      {open && (
        <div className="ai-panel" style={{
          position: 'fixed', bottom: 92, right: 24, zIndex: 999,
          width: 'min(336px, calc(100vw - 32px))',
          height: 'min(452px, calc(100vh - 120px))',
          borderRadius: 18,
          background: '#fff',
          boxShadow: '0 8px 40px rgba(0,0,0,0.13)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          animation: 'aichatUp 0.18s cubic-bezier(0.16,1,0.3,1)',
        }}>

          {/* Header — white */}
          <div style={{ background: '#fff', padding: '13px 16px 8px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontWeight: 800, fontSize: 19, color: '#11181c', letterSpacing: '-0.01em' }}>WFS AI</div>
            {messages.length > 0 && (
              <button
                onClick={() => {
                  setMessages([]); setInput(''); setError(''); setMultiline(false);
                  if (inputRef.current) inputRef.current.style.height = '19px';
                }}
                title="Clear chat"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', background: '#f4f4f5', color: '#71717a', fontSize: 11, fontWeight: 600, borderRadius: 999, padding: '5px 10px', cursor: 'pointer', outline: 'none' }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
                Clear
              </button>
            )}
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 12px 6px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {messages.length === 0 && !loading && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 24, padding: '0 4px' }}>
                <div style={{ fontSize: 19, fontWeight: 800, color: '#11181c' }}>Hi there! 👋</div>
                <div style={{ fontSize: 13, color: '#a1a1aa', marginTop: 3, marginBottom: 18 }}>How can I help you today?</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, width: '100%' }}>
                  {SUGGESTIONS.map(s => (
                    <button
                      key={s.label}
                      className="ai-chip"
                      onClick={() => {
                        if (s.fill) {
                          setInput(s.fill);
                          setMultiline(false);
                          setTimeout(() => { const el = inputRef.current; if (el) { el.focus(); el.setSelectionRange(s.fill!.length, s.fill!.length); } }, 0);
                        } else if (s.prompt) {
                          send(s.prompt);
                        }
                      }}
                      style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 7, padding: '10px 11px', border: '1px solid #ececec', borderRadius: 12, background: '#fff', cursor: 'pointer', outline: 'none' }}
                    >
                      <span style={{ fontSize: 15, lineHeight: 1 }}>{s.icon}</span>
                      <span style={{ fontSize: 11.5, fontWeight: 500, color: '#3f3f46', lineHeight: 1.3 }}>{s.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                {msg.role === 'user' ? (
                  <div style={{
                    maxWidth: '80%',
                    padding: '8px 16px',
                    borderRadius: 999,
                    background: '#ebebeb',
                    color: '#18181b',
                    fontSize: 12.5, lineHeight: 1.55,
                  }}>
                    {renderText(msg.content)}
                  </div>
                ) : (
                  <div style={{ maxWidth: '90%', fontSize: 12.5, lineHeight: 1.65, color: '#18181b', padding: '2px 4px' }}>
                    {renderText(msg.content)}
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div style={{ background: '#f0f0f0', borderRadius: 999 }}>
                  <TypingDots />
                </div>
              </div>
            )}

            {error && (
              <div style={{ background: '#fff0f3', borderRadius: 12, padding: '7px 12px', fontSize: 11.5, color: '#f31260' }}>
                {error}
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{ padding: '6px 12px 18px', flexShrink: 0 }}>
            <div style={{ display: 'flex', gap: 7, alignItems: 'flex-end', background: '#f0f0f0', borderRadius: multiline ? 18 : 999, padding: '5px 5px 5px 14px', transition: 'border-radius 0.12s' }}>
              <textarea
                ref={inputRef}
                className="ai-ta"
                value={input}
                onChange={e => {
                  setInput(e.target.value);
                  const el = e.target;
                  el.style.height = 'auto';
                  el.style.height = `${Math.min(el.scrollHeight, 88)}px`;
                  setMultiline(el.scrollHeight > 32);
                }}
                onKeyDown={handleKeyDown}
                placeholder="Ask about your data…"
                rows={1}
                style={{
                  flex: 1, border: 'none', background: 'transparent', resize: 'none', outline: 'none',
                  fontSize: 12.5, color: '#18181b', lineHeight: 1.5, height: 19, maxHeight: 88, overflowY: 'auto',
                  fontFamily: 'inherit', padding: '3px 0',
                }}
              />
              <button
                className="ai-send"
                onClick={() => send()}
                disabled={!input.trim() || loading}
                style={{
                  width: 30, height: 30, borderRadius: '50%', border: 'none',
                  background: '#006FEE', color: '#fff', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, outline: 'none', transition: 'opacity 0.15s',
                }}
              >
                <SendIcon />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
