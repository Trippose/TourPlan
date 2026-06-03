// 첫 진입 사용자용 친절 가이드 카드 — 5스텝 + 핵심 용어 + 단축키 + 닫기 영속
// localStorage('welcome-guide-dismissed')로 닫음 상태 영속, '?' 도움말 버튼으로 재오픈 가능
'use client';

import { useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'tour-pricing-welcome-dismissed';

interface Props {
  forceOpen?: boolean;
  onClose?: () => void;
}

export function WelcomeGuide({ forceOpen, onClose }: Props) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    setMounted(true);
    if (forceOpen) {
      setOpen(true);
      return;
    }
    try {
      const dismissed = localStorage.getItem(STORAGE_KEY) === 'true';
      if (!dismissed) setOpen(true);
    } catch {
      setOpen(true);
    }
  }, [forceOpen]);

  // '도움말'(forceOpen)로 열릴 때 — 페이지 어디서 눌러도 가이드로 스크롤.
  // main 최상단 인라인이라 스크롤 위치에 따라 화면 밖/ sticky 헤더 뒤로 가려 "위가 잘려" 보이던 문제 해소.
  useEffect(() => {
    if (open && forceOpen && ref.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [open, forceOpen]);

  if (!mounted || !open) return null;

  const close = (remember: boolean) => {
    setOpen(false);
    if (remember) {
      try {
        localStorage.setItem(STORAGE_KEY, 'true');
      } catch {}
    }
    onClose?.();
  };

  return (
    <section
      ref={ref}
      role="region"
      aria-label="투어 단가 빌더 사용법 가이드"
      className="mb-4 scroll-mt-24 rounded-2xl border-2 p-4 sm:p-5"
      style={{
        borderColor: '#FBE0E8',
        background: 'linear-gradient(135deg, #FFF7FA 0%, #FFF 100%)',
        boxShadow: '0 8px 24px rgba(192, 48, 107, 0.06)',
      }}
    >
      <header className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-black tracking-tight sm:text-lg" style={{ color: '#1F2937' }}>
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-black tracking-widest" style={{ backgroundColor: '#FBE0E8', color: '#C0306B' }}>
            🎯 빠른 시작
          </span>
          <span className="dark:text-neutral-100">5분이면 견적 1건 완성됩니다</span>
        </h2>
        <button
          type="button"
          onClick={() => close(true)}
          className="rounded-lg border px-2 py-1 text-xs font-bold transition hover:scale-105"
          style={{ borderColor: '#E7E2D5', color: '#4B5563', backgroundColor: 'white' }}
          aria-label="가이드 닫기 (다시 표시 안 함 — 헤더 '도움말'로 재오픈 가능)"
          title="닫기 (다시 표시 안 함)"
        >
          ✕
        </button>
      </header>

      <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { n: 1, t: '인원·기간', d: '성인·아동·유아 수, 출발·종료일을 먼저 정합니다.' },
          { n: 2, t: '차량·가이드', d: '차종을 선택하면 최대 탑승 인원이 자동 입력됩니다.' },
          { n: 3, t: '코스(일정)', d: '카카오맵 검색·마우스 드래그로 경유지 좌표를 잡습니다.' },
          { n: 4, t: '판매가·수수료', d: '판매가를 넣으면 채널별 BEP와 1인 수익을 실시간 계산.' },
          { n: 5, t: '매트릭스 확인', d: '인원 × 채널 표에서 손익분기 인원을 한 눈에 보세요.' },
        ].map((s) => (
          <li
            key={s.n}
            className="rounded-xl border bg-white p-3 text-xs dark:bg-neutral-900 dark:text-neutral-100"
            style={{ borderColor: '#F0E8DA' }}
          >
            <div className="mb-1 flex items-center gap-1.5">
              <span
                className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black text-white"
                style={{ backgroundColor: '#C0306B' }}
                aria-hidden
              >
                {s.n}
              </span>
              <strong className="text-[13px]" style={{ color: '#1F2937' }}>
                <span className="dark:text-neutral-100">{s.t}</span>
              </strong>
            </div>
            <p className="leading-relaxed text-[12px]" style={{ color: '#4B5563' }}>
              <span className="dark:text-neutral-300">{s.d}</span>
            </p>
          </li>
        ))}
      </ol>

      <div className="mt-3 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-2">
        <div className="rounded-lg px-3 py-2" style={{ backgroundColor: '#F7EBC4', color: '#A38420' }}>
          <strong>💡 BEP 의미</strong> — 그룹 공통(차량+가이드) ÷ 인원 + 1인 원가 = 수수료 차감 판매가와 같아지는 손익분기점.
        </div>
        <div className="rounded-lg px-3 py-2" style={{ backgroundColor: '#CDEDDB', color: '#138060' }}>
          <strong>🧮 자동 계산</strong> — 모든 입력은 즉시 매트릭스·BEP·운영 권장으로 반영됩니다 (저장 버튼 불필요, 로컬 자동 저장).
        </div>
      </div>
    </section>
  );
}
