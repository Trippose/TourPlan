// AI 투어 단가 도우미 — 실제 대화형 (Anthropic Claude API + 룰 폴백)
// POST /api/chat → { reply, mode, provider } 수신
// 사용자 컨텍스트(인원·경유지·판매가) 자동 첨부 — 답변 정확도 향상
'use client';

import { useEffect, useRef, useState } from 'react';
import { chatDbSave, chatDbLoadAll, chatDbClear, type StoredMessage } from '@/lib/chat-db';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  meta?: { mode?: string; provider?: string; ts?: number };
}

interface Context {
  packageName?: string;
  productType?: string;
  nights?: number;
  partyTotal?: number;
  adult?: number;
  youth?: number;
  child?: number;
  infant?: number;
  partyTiered?: boolean;
  vehiclesCount?: number;
  vehicleKinds?: string[];
  totalSeats?: number;
  guidesCount?: number;
  guideLanguages?: string[];
  stopsCount?: number;
  stopTypes?: string[];
  startTime?: string;
  salePrice?: number;
  channelsActive?: number;
  channelNames?: string[];
}

const SUGGESTIONS: string[] = [
  'BEP는 어떻게 계산되나요?',
  '판매가에서 수수료는 어떻게 차감되나요?',
  '차종 선택 시 인원이 자동 입력되나요?',
  '코스 좌표를 마우스로 옮길 수 있나요?',
  'PWA로 설치하는 방법은?',
];

// 마크다운 lite — **굵게**·`code`·줄바꿈·불릿만 React 노드 트리로 변환
// dangerouslySetInnerHTML 미사용. 모든 텍스트는 React가 자동 escape → XSS 0
function renderInlineTokens(line: string, baseKey: string): React.ReactNode[] {
  // **굵게** 와 `code` 만 인식. 매칭 외 텍스트는 그대로 (React가 escape)
  const tokens: React.ReactNode[] = [];
  const regex = /(\*\*([^*]+)\*\*)|(`([^`]+)`)/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  let nodeIdx = 0;
  while ((m = regex.exec(line)) !== null) {
    if (m.index > lastIdx) {
      tokens.push(line.slice(lastIdx, m.index));
    }
    if (m[2] !== undefined) {
      tokens.push(<strong key={`${baseKey}-s${nodeIdx++}`}>{m[2]}</strong>);
    } else if (m[4] !== undefined) {
      tokens.push(
        <code
          key={`${baseKey}-c${nodeIdx++}`}
          className="rounded bg-neutral-100 px-1 text-[12px] dark:bg-neutral-800"
        >
          {m[4]}
        </code>,
      );
    }
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < line.length) {
    tokens.push(line.slice(lastIdx));
  }
  return tokens;
}

function renderMarkdownLite(text: string): React.ReactNode {
  const lines = text.split('\n');
  return lines.map((line, i) => {
    const isBullet = /^\s*[•*]\s/.test(line);
    if (isBullet) {
      const content = line.replace(/^\s*[•*]\s/, '');
      return (
        <div key={i} className="ml-3 flex gap-1.5">
          <span aria-hidden style={{ color: '#6E37CC' }}>•</span>
          <span>{renderInlineTokens(content, `b${i}`)}</span>
        </div>
      );
    }
    if (line.trim() === '') return <div key={i}>&nbsp;</div>;
    return <div key={i}>{renderInlineTokens(line, `l${i}`)}</div>;
  });
}

interface Props {
  context?: Context;
  /** 외부에서 챗봇 열기 토글 제어 (Ctrl+K 글로벌 단축키용). undefined면 내부 state만 사용. */
  openSignal?: number;
}

// localStorage 키 — 챗봇 대화 영속
const HISTORY_KEY = 'tour-pricing-chat-history';
const MAX_HISTORY = 50;

function loadHistory(): Message[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((m) => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant'));
  } catch {
    return [];
  }
}

function saveHistory(msgs: Message[]) {
  if (typeof window === 'undefined') return;
  try {
    const trimmed = msgs.slice(-MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
  } catch {}
}

export function Chatbot({ context, openSignal }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'ai' | 'rule-fallback' | 'unknown'>('unknown');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null); // 드롭다운 컨테이너 — 외부 클릭 감지용

  // 마운트 시 영속 복원 — IndexedDB 우선, 실패 시 localStorage 폴백
  useEffect(() => {
    (async () => {
      const fromDb = await chatDbLoadAll();
      if (fromDb.length > 0) {
        const converted: Message[] = fromDb.map((m) => ({
          role: m.role,
          content: m.content,
          meta: { mode: m.mode, provider: m.provider, ts: m.ts },
        }));
        setMessages(converted);
        return;
      }
      const restored = loadHistory();
      if (restored.length > 0) setMessages(restored);
    })();
  }, []);

  // 메시지 변경 시 localStorage 저장 (즉시 폴백) + IndexedDB 비동기 저장 (무한 영속)
  useEffect(() => {
    if (messages.length === 0) return;
    saveHistory(messages); // localStorage는 가벼우므로 매 변경마다 갱신(slice로 트림)
    // ⚠ 스트리밍 중에는 토큰마다 messages가 갱신되므로 IndexedDB 저장을 건너뛴다.
    // chatDbSave는 store.add(autoIncrement)라 호출마다 새 레코드 → 토큰 수만큼 부분 중복이 쌓인다.
    // streaming=false로 전환되는 순간(스트리밍 완료) effect가 재발화하여 완성된 마지막 메시지를 1회만 저장한다.
    if (streaming) return;
    const last = messages[messages.length - 1];
    // 빈 placeholder(content==='')는 저장하지 않는다.
    if (last && last.meta?.ts && last.content !== '') {
      const stored: StoredMessage = {
        ts: last.meta.ts,
        role: last.role,
        content: last.content,
        mode: last.meta.mode,
        provider: last.meta.provider,
      };
      void chatDbSave(stored);
    }
  }, [messages, streaming]);

  // 외부 토글 신호 — openSignal이 바뀔 때마다 열기/닫기 토글
  // 첫 마운트 시점에는 토글 안 함 (자동 열림 박멸)
  const firstMount = useRef(true);
  useEffect(() => {
    if (openSignal === undefined) return;
    if (firstMount.current) {
      firstMount.current = false;
      return;
    }
    setOpen((o) => !o);
  }, [openSignal]);

  // 메시지 추가 시 하단으로 스크롤
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading, streaming]);

  // 다이얼로그 열림 시 입력에 포커스
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  // ESC로 닫기
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading || streaming) return;

    const userMsg: Message = { role: 'user', content: trimmed, meta: { ts: Date.now() } };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    setLoading(true);
    setError(null);

    const payload = JSON.stringify({
      messages: next.map((m) => ({ role: m.role, content: m.content })),
      context,
      stream: true,
    });

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });

      if (res.status === 429) {
        const data = await res.json().catch(() => ({}));
        setError(`요청이 너무 많습니다. ${data.retryAfter ?? 60}초 후 다시 시도해주세요.`);
        setLoading(false);
        return;
      }
      if (res.status === 401) {
        setError('세션이 만료되었습니다. 다시 로그인해주세요.');
        setLoading(false);
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(`응답 오류 (${res.status}) — ${data.error ?? '알 수 없는 오류'}`);
        setLoading(false);
        return;
      }

      // 스트리밍 응답 — text/event-stream
      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('text/event-stream') && res.body) {
        setLoading(false);
        setStreaming(true);
        let accumulated = '';
        let receivedMode: 'ai' | 'rule-fallback' = 'ai';
        let receivedProvider = 'claude-opus-4-8';

        // assistant placeholder 1건 추가 후 스트리밍 토큰으로 in-place 갱신
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: '', meta: { mode: 'ai', provider: receivedProvider, ts: Date.now() } },
        ]);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            // SSE 이벤트는 \n\n 구분
            let idx;
            while ((idx = buffer.indexOf('\n\n')) >= 0) {
              const raw = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 2);
              const lines = raw.split('\n');
              let event = 'message';
              let data = '';
              for (const line of lines) {
                if (line.startsWith('event: ')) event = line.slice(7);
                else if (line.startsWith('data: ')) data = line.slice(6);
              }
              if (!data) continue;
              let payload: { text?: string; mode?: string; provider?: string; reason?: string };
              try {
                payload = JSON.parse(data);
              } catch {
                continue;
              }
              if (event === 'meta') {
                if (payload.mode === 'rule-fallback') receivedMode = 'rule-fallback';
                if (payload.provider) receivedProvider = payload.provider;
                setMode(receivedMode);
                if (receivedMode === 'rule-fallback' && payload.reason) {
                  setError(`AI 일시 미사용 — ${payload.reason}`);
                }
              } else if (event === 'delta' && payload.text) {
                accumulated += payload.text;
                setMessages((prev) => {
                  const last = prev[prev.length - 1];
                  if (!last || last.role !== 'assistant') return prev;
                  return [
                    ...prev.slice(0, -1),
                    { ...last, content: accumulated, meta: { mode: receivedMode, provider: receivedProvider, ts: Date.now() } },
                  ];
                });
              } else if (event === 'done') {
                // 완료
              }
            }
          }
        } finally {
          setStreaming(false);
        }
        return;
      }

      // 일괄 응답 폴백
      const data = await res.json().catch(() => ({}));
      if (!data.success) {
        setError(`응답 오류 — ${data.error ?? '알 수 없는 오류'}`);
        setLoading(false);
        return;
      }
      const assistantMsg: Message = {
        role: 'assistant',
        content: data.reply,
        meta: { mode: data.mode, provider: data.provider, ts: Date.now() },
      };
      setMessages([...next, assistantMsg]);
      if (data.mode === 'ai' || data.mode === 'rule-fallback') setMode(data.mode);
      setLoading(false);
    } catch (err) {
      setError(`네트워크 오류 — ${err instanceof Error ? err.message : String(err)}`);
      setLoading(false);
      setStreaming(false);
      // 스트리밍 중 추가한 빈 assistant placeholder(content==='')가 빈 말풍선으로 잔존하는 것을 방지 — 제거
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        return last && last.role === 'assistant' && last.content === '' ? prev.slice(0, -1) : prev;
      });
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter 전송, Shift+Enter 줄바꿈
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const reset = () => {
    setMessages([]);
    try { localStorage.removeItem(HISTORY_KEY); } catch {}
    void chatDbClear();
    setError(null);
    setMode('unknown');
  };

  // 드롭다운 — 바깥 클릭 또는 ESC 시 닫기 (토글 버튼 클릭은 컨테이너 내부라 닫히지 않음)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  return (
    <div ref={dropdownRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center justify-center gap-1 rounded-lg border bg-white px-2 text-xs font-bold transition hover:scale-105 dark:bg-neutral-800 dark:text-neutral-100"
        style={{ borderColor: 'var(--border, #E7E2D5)', minWidth: 36, minHeight: 36, color: '#6E37CC' }}
        aria-label="AI 도우미 열기"
        aria-expanded={open}
        title="AI 투어 단가 도우미 — Claude Opus 4.8 기반 (Anthropic, 워터트리 정책상 0.1% 품질 우선)"
      >
        <span aria-hidden>🤖</span>
        <span className="hidden sm:inline">도우미</span>
      </button>

      {open && (
        // 도우미 버튼 아래(헤더 하단) 우측에 펼치는 드롭다운. fixed=viewport 기준이라 좌우/상단
        // 잘림이 없다(헤더 backdrop-blur 제거로 가능). 화면 높이를 넘으면 내부(메시지)만 스크롤.
        <div
          role="dialog"
          aria-label="AI 투어 단가 도우미"
          className="fixed inset-x-2 top-14 z-50 flex max-h-[calc(100dvh-5rem)] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-neutral-900 dark:text-neutral-100 sm:inset-x-auto sm:right-4 sm:top-18 sm:w-[400px]"
          style={{ border: '1px solid var(--border, #E7E2D5)' }}
        >
            <header
              className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3"
              style={{ borderColor: 'var(--border, #E7E2D5)' }}
            >
              <h2 className="flex items-center gap-2 text-base font-black tracking-tight">
                <span aria-hidden>🤖</span>
                <span>투어 단가 도우미</span>
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-black tracking-widest"
                  style={{
                    backgroundColor: mode === 'ai' ? '#CDEDDB' : mode === 'rule-fallback' ? '#F7EBC4' : '#E4DCF6',
                    color: mode === 'ai' ? '#138060' : mode === 'rule-fallback' ? '#A38420' : '#6E37CC',
                  }}
                  title={
                    mode === 'ai'
                      ? 'Anthropic Claude API 응답 중'
                      : mode === 'rule-fallback'
                      ? 'AI 미설정 — 룰 기반 즉답'
                      : '응답 대기 중'
                  }
                >
                  {mode === 'ai' ? 'AI' : mode === 'rule-fallback' ? '룰' : '대기'}
                </span>
              </h2>
              <div className="flex items-center gap-1">
                {messages.length > 0 && (
                  <button
                    type="button"
                    onClick={reset}
                    className="rounded-lg border px-2 py-1 text-[11px] font-bold transition hover:scale-105"
                    style={{ borderColor: 'var(--border, #E7E2D5)', color: '#4B5563' }}
                    aria-label="대화 초기화"
                    title="새 대화 시작 (localStorage + IndexedDB 모두 비움)"
                  >
                    ↻ 새 대화
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg border px-2 py-1 text-xs font-bold"
                  style={{ borderColor: 'var(--border, #E7E2D5)' }}
                  aria-label="도우미 닫기"
                >
                  ✕
                </button>
              </div>
            </header>

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
              {messages.length === 0 && (
                <>
                  <div
                    className="mb-3 rounded-lg border-l-4 px-3 py-2 text-xs leading-relaxed"
                    style={{ borderColor: '#6E37CC', backgroundColor: '#E4DCF6', color: '#6E37CC' }}
                  >
                    <strong>👋 안녕하세요!</strong> 투어 단가 빌더 사용법·BEP 계산·채널 분석 등 무엇이든 물어보세요. AI가 답변하지 못할 때는 룰 기반 FAQ가 자동 폴백됩니다.
                  </div>
                  <p className="mb-2 text-[11px] font-bold" style={{ color: '#52606D' }}>
                    💡 자주 묻는 질문
                  </p>
                  <ul className="space-y-1.5">
                    {SUGGESTIONS.map((q) => (
                      <li key={q}>
                        <button
                          type="button"
                          onClick={() => sendMessage(q)}
                          className="w-full rounded-lg border bg-white px-3 py-2 text-left text-xs font-semibold transition hover:scale-[1.01] dark:bg-neutral-800 dark:text-neutral-100"
                          style={{ borderColor: 'var(--border, #E7E2D5)', color: '#1F2937' }}
                        >
                          → {q}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`mb-3 ${m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}`}
                >
                  <div
                    className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                      m.role === 'user' ? 'text-white' : 'border bg-white dark:bg-neutral-800 dark:text-neutral-100'
                    }`}
                    style={
                      m.role === 'user'
                        ? { backgroundColor: '#C0306B' }
                        : { borderColor: 'var(--border, #E7E2D5)', color: '#1F2937' }
                    }
                  >
                    {m.role === 'assistant' ? (
                      <div className="space-y-1 dark:text-neutral-100">{renderMarkdownLite(m.content)}</div>
                    ) : (
                      <span>{m.content}</span>
                    )}
                    {m.meta?.mode === 'rule-fallback' && (
                      <p className="mt-1.5 border-t pt-1 text-[10px]" style={{ borderColor: '#E7E2D5', color: '#A38420' }}>
                        ⓘ 룰 기반 폴백 (AI 미설정/일시 실패)
                      </p>
                    )}
                  </div>
                </div>
              ))}

              {loading && !streaming && (
                <div className="flex justify-start">
                  <div
                    className="rounded-2xl border bg-white px-3 py-2 text-sm dark:bg-neutral-800"
                    style={{ borderColor: 'var(--border, #E7E2D5)', color: '#4B5563' }}
                  >
                    <span className="inline-block animate-pulse">▍</span>
                    <span className="ml-1.5 dark:text-neutral-300">생각 중…</span>
                  </div>
                </div>
              )}
              {streaming && (
                <div className="text-center text-[10px]" style={{ color: '#6E37CC' }}>
                  <span className="inline-block animate-pulse">▍</span> 스트리밍 중…
                </div>
              )}

              {error && (
                <div
                  role="alert"
                  className="mt-2 rounded-lg px-3 py-2 text-xs font-semibold"
                  style={{ backgroundColor: '#FBE0E8', color: '#C0306B' }}
                >
                  ⚠ {error}
                </div>
              )}
            </div>

            <form onSubmit={onSubmit} className="shrink-0 border-t p-3" style={{ borderColor: 'var(--border, #E7E2D5)' }}>
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="질문을 입력하세요 (Enter 전송 · Shift+Enter 줄바꿈)"
                  rows={2}
                  maxLength={2000}
                  className="flex-1 resize-none rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 dark:bg-neutral-800 dark:text-neutral-100"
                  style={{ borderColor: 'var(--border, #E7E2D5)' }}
                  disabled={loading || streaming}
                  aria-label="질문 입력"
                />
                <button
                  type="submit"
                  disabled={loading || streaming || !input.trim()}
                  className="h-10 shrink-0 rounded-lg px-3 text-sm font-black text-white transition disabled:opacity-40"
                  style={{ backgroundColor: '#6E37CC' }}
                  aria-label="질문 전송"
                  title="질문 전송 (Enter)"
                >
                  전송
                </button>
              </div>
              <p className="mt-1.5 text-[10px]" style={{ color: '#52606D' }}>
                분당 20회 제한 · 입력 컨텍스트는 답변 정확도를 위해 자동 첨부됩니다 · 메시지는 서버에 저장되지 않음
              </p>
            </form>
        </div>
      )}
    </div>
  );
}
