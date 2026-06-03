// 인증 게이트 — 두 비밀번호 입력 페이지
// 둘 다 정확히 일치해야 메인 페이지 진입 가능
//
// Next.js 16 / React 19 — useSearchParams 가 dev HMR 에서 'ReactCurrentDispatcher' 오류 반복 트리거.
// 회피책: window.location.search 직접 파싱 (CSR bailout 우회, Suspense 의존 제거).
'use client';

import { useEffect, useState, FormEvent } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { ArithPlaceholder, type ArithValue } from './ArithChallenge';
import { clearState } from '@/lib/storage';

// 산술 4지선다는 SSR 비활성 — 첫 페인트부터 placeholder만, CSR 마운트 시 실제 위젯 렌더
// → SSR/CSR 모두 동일 높이 160px 박스 → layout shift 0, "있고 없고 겹침" 깜빡임 제거
const ArithChallenge = dynamic(
  () => import('./ArithChallenge').then((m) => ({ default: m.ArithChallenge })),
  { ssr: false, loading: () => <ArithPlaceholder /> },
);

const PAL = {
  bg: '#FAF7F2',
  surface: '#FFFFFF',
  line: '#E7E2D5',
  ink: '#1F2937',
  inkSoft: '#4B5563',
  mute: '#52606D',
  rose: '#C0306B',
  rosePale: '#FBE0E8',
  emerald: '#138060',
  emeraldPale: '#CDEDDB',
  violet: '#6E37CC',
  violetPale: '#E4DCF6',
};

export default function LoginPage() {
  const router = useRouter();
  // window.location.search 를 useEffect 로 1회 파싱 (SSR 안전)
  const [reason, setReason] = useState<string | null>(null);
  const [from, setFrom] = useState<string>('/');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    setReason(sp.get('reason'));
    setFrom(sp.get('from') ?? '/');
  }, []);

  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [show1, setShow1] = useState(false);
  const [show2, setShow2] = useState(false);

  // 4지선다 산술 보안 — ArithChallenge 컴포넌트가 자체 상태 관리, onChange 콜백으로 현재 값 수신
  const [arith, setArith] = useState<ArithValue | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!pw1 || !pw2) {
      setMsg({ ok: false, text: '두 비밀번호 모두 입력하세요.' });
      return;
    }
    // 4지선다 검증 — 산술 정답 선택 안 했거나 틀리면 차단
    if (!arith || arith.selected === null) {
      setMsg({ ok: false, text: '하단 산술 문제의 정답을 선택하세요.' });
      return;
    }
    if (arith.selected !== arith.answer) {
      setMsg({ ok: false, text: `산술 정답이 아닙니다 (${arith.a} + ${arith.b} = ?). 다시 풀어주세요.` });
      return;
    }
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pw1, pw2 }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        // 로그인 성공 — 이전 작업본(현재 작업)을 비워 메인 첫 화면을 빈 양식으로 시작.
        // 보관함(저장된 견적)은 보존. 작업 중 새로고침은 쿠키가 유효해 로그인을 거치지 않으므로 복원이 유지된다.
        clearState();
        // 메인으로 이동 (또는 원래 가려던 경로)
        router.replace(from);
      } else if (res.status === 429) {
        const retry = data.retryAfter ?? 60;
        setMsg({ ok: false, text: `로그인 시도가 너무 많습니다. ${retry}초 후 다시 시도하세요.` });
      } else if (res.status === 500 && data.error === 'auth-not-configured') {
        setMsg({
          ok: false,
          text: '서버 설정 누락 — 운영자에게 문의 (.env.local AUTH_PW1·AUTH_PW2·AUTH_SECRET 설정 필요).',
        });
      } else {
        setMsg({ ok: false, text: '비밀번호가 일치하지 않습니다.' });
      }
    } catch (err) {
      setMsg({
        ok: false,
        text: `네트워크 오류 — ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="__login-grid grid min-h-dvh place-items-center p-4 dark:bg-neutral-950 dark:text-neutral-100"
      style={{ backgroundColor: 'var(--login-bg, ' + PAL.bg + ')', color: 'var(--login-ink, ' + PAL.ink + ')' }}
    >
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-2xl border bg-white p-6 sm:p-8 dark:bg-neutral-900 dark:text-neutral-100"
        style={{
          /* inline width 강제 — Tailwind CSS 로드 전에도 SSR 첫 페인트부터 28rem 고정 (콜드 컴파일 1420px 점프 박멸) */
          maxWidth: '28rem',
          width: '100%',
          marginLeft: 'auto',
          marginRight: 'auto',
          borderColor: 'var(--login-line, ' + PAL.line + ')',
          boxShadow: '0 12px 32px rgba(192, 48, 107, 0.10)',
        }}
        aria-label="비밀번호 인증"
      >
        <div className="mb-1 flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-black tracking-widest"
            style={{ backgroundColor: PAL.rosePale, color: PAL.rose }}
          >
            🔒 보안 접속
          </span>
        </div>
        <h1 className="text-2xl font-black tracking-tight" style={{ color: PAL.ink }}>
          투어 패키지 <span style={{ color: PAL.rose }}>단가 빌더</span>
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed" style={{ color: PAL.inkSoft }}>
          운영자에게 발급받은 <strong style={{ color: PAL.violet }}>두 비밀번호</strong>를 모두 입력하세요.
          <br />
          <span className="text-xs" style={{ color: PAL.mute }}>
            두 값이 정확히 일치할 때만 진입할 수 있습니다 (분당 5회 시도 제한).
          </span>
        </p>

        {reason === 'not-configured' && (
          <div
            className="mt-4 rounded-lg border-l-4 px-3 py-2 text-xs leading-relaxed"
            style={{ borderColor: PAL.rose, backgroundColor: PAL.rosePale, color: PAL.rose }}
          >
            <strong>서버 설정 안내</strong> — <code>.env.local</code>에 <strong>AUTH_PW1</strong>·
            <strong>AUTH_PW2</strong>·<strong>AUTH_SECRET</strong>이 설정되지 않았습니다. 운영자에게 문의하세요.
          </div>
        )}

        <div className="mt-5 space-y-3">
          <div>
            <label htmlFor="pw1" className="block text-xs font-bold" style={{ color: PAL.mute }}>
              1차 비밀번호
            </label>
            <div className="mt-1 flex items-stretch gap-1">
              <input
                id="pw1"
                type={show1 ? 'text' : 'password'}
                value={pw1}
                onChange={(e) => setPw1(e.target.value)}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                inputMode="text"
                maxLength={128}
                className="h-11 flex-1 rounded-lg border px-3 text-base font-semibold tabular-nums focus:outline-none focus:ring-2"
                style={{ borderColor: PAL.line }}
                placeholder="1차 비밀번호 입력"
                aria-required="true"
              />
              <button
                type="button"
                onClick={() => setShow1((s) => !s)}
                className="rounded-lg border px-2 text-xs font-bold transition hover:scale-105"
                style={{ borderColor: PAL.line, color: PAL.mute, backgroundColor: 'white' }}
                title={show1 ? '숨기기' : '보이기'}
                aria-label={show1 ? '1차 비밀번호 숨기기' : '1차 비밀번호 보이기'}
              >
                {show1 ? '🙈' : '👁'}
              </button>
            </div>
          </div>
          <div>
            <label htmlFor="pw2" className="block text-xs font-bold" style={{ color: PAL.mute }}>
              2차 비밀번호
            </label>
            <div className="mt-1 flex items-stretch gap-1">
              <input
                id="pw2"
                type={show2 ? 'text' : 'password'}
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                inputMode="text"
                maxLength={128}
                className="h-11 flex-1 rounded-lg border px-3 text-base font-semibold tabular-nums focus:outline-none focus:ring-2"
                style={{ borderColor: PAL.line }}
                placeholder="2차 비밀번호 입력"
                aria-required="true"
              />
              <button
                type="button"
                onClick={() => setShow2((s) => !s)}
                className="rounded-lg border px-2 text-xs font-bold transition hover:scale-105"
                style={{ borderColor: PAL.line, color: PAL.mute, backgroundColor: 'white' }}
                title={show2 ? '숨기기' : '보이기'}
                aria-label={show2 ? '2차 비밀번호 숨기기' : '2차 비밀번호 보이기'}
              >
                {show2 ? '🙈' : '👁'}
              </button>
            </div>
          </div>
        </div>

        {/* 4지선다 산술 보안 — dynamic ssr:false, SSR/CSR 모두 동일 높이 168px 박스 */}
        <div className="mt-5">
          <ArithChallenge onChange={setArith} />
        </div>

        {msg && (
          <div
            role="alert"
            className="mt-4 rounded-lg px-3 py-2 text-sm font-semibold"
            style={{
              backgroundColor: msg.ok ? PAL.emeraldPale : PAL.rosePale,
              color: msg.ok ? PAL.emerald : PAL.rose,
            }}
          >
            {msg.ok ? '✓ ' : '⚠ '}
            {msg.text}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="mt-5 h-12 w-full rounded-xl text-base font-black tracking-wide text-white transition disabled:opacity-50"
          style={{ backgroundColor: PAL.rose }}
          aria-busy={loading}
        >
          {loading ? '확인 중…' : '🔓 진입'}
        </button>

        <p className="mt-4 text-center text-[11px]" style={{ color: PAL.mute }}>
          세션 24시간 유지 · 분당 5회 시도 제한 · 산술 4지선다 보안 · 모든 통신 HTTPS 권장
        </p>
      </form>
    </div>
  );
}
