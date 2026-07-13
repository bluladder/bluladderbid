import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageCircle, X, Send, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';

type Msg = { role: 'user' | 'assistant'; content: string };

// The browser talks ONLY to the server-side ai-chat orchestrator. All pricing,
// availability and booking logic lives behind allowlisted server tools.
const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`;

const SESSION_KEY = 'bluladder_chat_session';
const MESSAGES_KEY = 'bluladder_chat_messages';

// The exact, opt-in-only marketing consent language shown next to the checkbox.
// It is recorded verbatim through the canonical consent service on the server.
export const MARKETING_CONSENT_LANGUAGE =
  'Send me occasional promotions and offers from BluLadder by text or email. Not required to get a quote or book.';

function getSessionToken(): string {
  try {
    let token = localStorage.getItem(SESSION_KEY);
    if (!token || !/^[A-Za-z0-9_-]{8,100}$/.test(token)) {
      token = (crypto.randomUUID?.() ?? `s${Date.now()}${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '');
      localStorage.setItem(SESSION_KEY, token);
    }
    return token;
  } catch {
    return `s${Date.now()}${Math.random().toString(36).slice(2)}`;
  }
}

function loadStoredMessages(): Msg[] {
  try {
    const raw = localStorage.getItem(MESSAGES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(-100) : [];
  } catch {
    return [];
  }
}

async function sendChat(sessionToken: string, message: string, marketingConsent: boolean): Promise<string> {
  const resp = await fetch(CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify({
      sessionToken,
      message,
      // Only ever sent when explicitly ticked; never defaulted to true.
      marketingConsent,
      consentLanguage: marketingConsent ? MARKETING_CONSENT_LANGUAGE : undefined,
    }),
  });
  const data = await resp.json().catch(() => ({ error: 'Connection failed' }));
  if (!resp.ok) throw new Error(data.error || `Error ${resp.status}`);
  return data.reply as string;
}

export default function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>(() => loadStoredMessages());
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [hasGreeted, setHasGreeted] = useState(false);
  // Explicit, opt-in-only. MUST start false — never preselect marketing consent.
  const [marketingConsent, setMarketingConsent] = useState(false);
  const sessionRef = useRef<string>(getSessionToken());
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // Preserve the conversation across minimize / page changes.
  useEffect(() => {
    try { localStorage.setItem(MESSAGES_KEY, JSON.stringify(messages.slice(-100))); } catch { /* ignore */ }
  }, [messages]);

  // Keep the composer focused for accessibility when the widget opens.
  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  // Show a static local greeting (no server call needed) the first time the
  // widget opens with an empty transcript.
  useEffect(() => {
    if (isOpen && !hasGreeted && messages.length === 0) {
      setHasGreeted(true);
      setMessages([{
        role: 'assistant',
        content: "Hi! 👋 I'm BluLadder's assistant. I can answer questions, give you a real quote for window cleaning, gutters, roof, house wash, or pressure washing, and even find an appointment time. What can I help you with?",
      }]);
    }
  }, [isOpen, hasGreeted, messages.length]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');
    const userMsg: Msg = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const reply = await sendChat(sessionRef.current, text, marketingConsent);
      setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Sorry, something went wrong: ${e.message}` }]);
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  }, [input, isLoading, marketingConsent]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <>
      {/* Floating bubble */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 flex items-center justify-center"
          aria-label="Open chat"
        >
          <MessageCircle className="w-6 h-6" />
        </button>
      )}

      {/* Chat window */}
      {isOpen && (
        <div className="fixed bottom-6 right-6 z-50 w-[380px] max-w-[calc(100vw-2rem)] h-[560px] max-h-[calc(100vh-3rem)] bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 fade-in duration-300">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-primary text-primary-foreground rounded-t-2xl">
            <div className="flex items-center gap-2">
              <MessageCircle className="w-5 h-5" />
              <div>
                <p className="font-semibold text-sm">BluLadder Quote Bot</p>
                <p className="text-xs opacity-80">Get an instant price estimate</p>
              </div>
            </div>
            <button onClick={() => setIsOpen(false)} className="p-1 hover:bg-white/20 rounded-full transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((msg, i) => (
              <div key={i} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed',
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground rounded-br-md'
                      : 'bg-muted text-foreground rounded-bl-md'
                  )}
                >
                  {msg.role === 'assistant' ? (
                    <div className="prose prose-sm max-w-none dark:prose-invert [&>p]:mb-1.5 [&>p:last-child]:mb-0 [&>ul]:mb-1.5 [&>ul]:pl-4">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <p>{msg.content}</p>
                  )}
                </div>
              </div>
            ))}
            {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
              <div className="flex justify-start">
                <div className="bg-muted text-muted-foreground rounded-2xl rounded-bl-md px-4 py-3">
                  <Loader2 className="w-4 h-4 animate-spin" />
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="p-3 border-t border-border">
            {/* Explicit marketing opt-in — never preselected. Not required to book. */}
            <label className="flex items-start gap-2 mb-2 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={marketingConsent}
                onChange={e => setMarketingConsent(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 rounded border-input accent-primary"
              />
              <span>{MARKETING_CONSENT_LANGUAGE}</span>
            </label>
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your message..."
                rows={1}
                className="flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-h-24 min-h-[40px]"
              />
              <Button
                size="icon"
                onClick={send}
                disabled={!input.trim() || isLoading}
                className="rounded-xl h-10 w-10 shrink-0"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
