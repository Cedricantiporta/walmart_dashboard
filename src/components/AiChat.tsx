'use client';

import { useState, useRef, useEffect } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const GRADIENT = 'linear-gradient(135deg, #006FEE 0%, #7828C8 55%, #F5A524 100%)';

const SendIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13"/>
    <polygon points="22 2 15 22 11 13 2 9 22 2"/>
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

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
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
        .ai-fab:hover { transform: scale(1.08) !important; box-shadow: 0 6px 28px rgba(120,40,200,0.35) !important; }
        .ai-send:hover:not(:disabled) { opacity: 0.82; }
        .ai-send:disabled { opacity: 0.35; cursor: not-allowed; }
      `}</style>

      {/* Floating button — gradient only, no icon */}
      <button
        className="ai-fab"
        onClick={() => setOpen(o => !o)}
        title="WFS AI"
        style={{
          position: 'fixed', bottom: 28, right: 28, zIndex: 1000,
          width: 48, height: 48, borderRadius: '50%', border: 'none',
          background: open ? '#18181b' : GRADIENT,
          color: '#fff', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 18px rgba(120,40,200,0.28)',
          outline: 'none',
        }}
      >
        {open && <CloseIcon />}
      </button>

      {/* Panel */}
      {open && (
        <div style={{
          position: 'fixed', bottom: 88, right: 28, zIndex: 999,
          width: 360, height: 500, borderRadius: 20,
          background: '#fff',
          boxShadow: '0 8px 40px rgba(0,0,0,0.13)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          animation: 'aichatUp 0.18s cubic-bezier(0.16,1,0.3,1)',
        }}>

          {/* Header — white */}
          <div style={{ background: '#fff', padding: '14px 18px 12px', flexShrink: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#11181c' }}>WFS AI</div>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 12px 6px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {messages.length === 0 && !loading && (
              <div style={{ textAlign: 'center', color: '#a1a1aa', fontSize: 12, marginTop: 40, lineHeight: 1.7 }}>
                Ask me anything about your<br />recovery data, clients, or billing.
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
          <div style={{ padding: '8px 12px 14px', flexShrink: 0 }}>
            <div style={{ display: 'flex', gap: 7, alignItems: 'flex-end', background: '#f0f0f0', borderRadius: 999, padding: '5px 5px 5px 14px' }}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about your data…"
                rows={1}
                style={{
                  flex: 1, border: 'none', background: 'transparent', resize: 'none', outline: 'none',
                  fontSize: 12.5, color: '#18181b', lineHeight: 1.5, maxHeight: 90, overflowY: 'auto',
                  fontFamily: 'inherit', padding: '3px 0',
                }}
              />
              <button
                className="ai-send"
                onClick={send}
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
            <div style={{ fontSize: 9.5, color: '#c4c4c8', textAlign: 'center', marginTop: 5 }}>Enter to send · Shift+Enter for newline</div>
          </div>
        </div>
      )}
    </>
  );
}
