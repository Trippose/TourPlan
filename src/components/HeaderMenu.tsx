// 헤더 작업 메뉴 — ⋯ 버튼 클릭 시 드롭다운으로 보조 작업 표시
// 공유·도움말·설치·PDF·Excel·초기화·로그아웃 7개를 한 곳에 모아 헤더 과밀 박멸
'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Item {
  id: string;
  label: string;
  icon: string;
  color: string;
  onClick: () => void;
  description?: string;
  emphasized?: boolean;
}

interface Props {
  items: Item[];
  extras?: ReactNode;
}

export function HeaderMenu({ items, extras }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 외부 클릭 시 닫기
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // 다음 tick에 리스너 등록 (현재 클릭 이벤트로 즉시 닫히지 않게)
    const t = setTimeout(() => {
      document.addEventListener('click', handler);
      document.addEventListener('keydown', escHandler);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('click', handler);
      document.removeEventListener('keydown', escHandler);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="inline-flex h-9 shrink-0 items-center justify-center gap-1 rounded-lg border bg-white px-2 text-xs font-bold transition hover:scale-105 no-print dark:bg-neutral-800 dark:text-neutral-100"
        style={{ borderColor: 'var(--border, #E7E2D5)', color: '#4B5563', minWidth: 36 }}
        aria-label="작업 메뉴"
        aria-expanded={open}
        aria-haspopup="menu"
        title="견적 작업 메뉴 (공유·도움말·설치·PDF·Excel·초기화·로그아웃)"
      >
        <span aria-hidden>⋯</span>
        <span className="hidden sm:inline">메뉴</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-11 z-50 w-64 rounded-xl border bg-white p-1.5 shadow-xl dark:bg-neutral-900"
          style={{ borderColor: 'var(--border, #E7E2D5)' }}
        >
          {extras && <div className="mb-1 border-b pb-1.5" style={{ borderColor: 'var(--border, #E7E2D5)' }}>{extras}</div>}
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-semibold transition hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800"
              style={{ color: item.emphasized ? item.color : '#1F2937' }}
              title={item.description}
            >
              <span aria-hidden style={{ fontSize: 16, width: 22 }}>{item.icon}</span>
              <span className="flex-1">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
