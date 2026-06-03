// 견적 보관함 모달 — 현재 견적을 이름 붙여 저장 + 저장된 목록에서 불러오기·삭제
// localStorage 기반(외부 전송 0). 구 슬롯 3개를 대체하는 다수 명명 보관 UI.
'use client';

import { useEffect, useState } from 'react';
import { LIBRARY_MAX, type LibraryItem } from '@/lib/storage';

const PAL = {
  line: '#E7E2D5',
  ink: '#1F2937',
  mute: '#52606D',
  violet: '#6E37CC',
  teal: '#0F807A',
  rose: '#C0306B',
};

interface Props {
  open: boolean;
  onClose: () => void;
  items: LibraryItem[];
  currentName: string; // 저장 input 기본값 (현재 패키지명)
  onSave: (name: string) => void;
  onLoad: (item: LibraryItem) => void;
  onDelete: (id: string) => void;
  onNew: () => void; // 새 견적 — 폼을 빈 양식으로 초기화
}

const fmtWon = (n: number) => `₩${Math.round(n).toLocaleString('ko-KR')}`;
const fmtDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
};

export function LibraryModal({ open, onClose, items, currentName, onSave, onLoad, onDelete, onNew }: Props) {
  const [name, setName] = useState(currentName);

  // 열릴 때마다 현재 패키지명을 기본 저장 이름으로 채움
  useEffect(() => {
    if (open) setName(currentName);
  }, [open, currentName]);

  // ESC로 닫기
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="견적 보관함"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 no-print"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-white p-5 shadow-2xl"
        style={{ border: `1px solid ${PAL.line}` }}
      >
        <header className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-black tracking-tight" style={{ color: PAL.ink }}>
            <span aria-hidden>📚</span>
            <span>견적 보관함</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border px-2 py-1 text-xs font-bold"
            style={{ borderColor: PAL.line, color: PAL.mute }}
            aria-label="보관함 닫기"
          >
            ✕
          </button>
        </header>

        {/* 새 견적 시작 — 폼을 빈 양식으로 초기화 (보관함 불러오기 전 새 작성용) */}
        <button
          type="button"
          onClick={onNew}
          className="mb-3 w-full rounded-lg border border-dashed py-2.5 text-sm font-bold transition hover:bg-violet-50"
          style={{ borderColor: PAL.violet, color: PAL.violet }}
          title="현재 작업을 비우고 빈 양식으로 새 견적을 시작합니다"
        >
          ＋ 새 견적 시작 (빈 양식으로)
        </button>

        {/* 현재 견적 저장 */}
        <div className="mb-4 rounded-lg border p-3" style={{ borderColor: PAL.line }}>
          <label className="mb-1 block text-xs font-bold" style={{ color: PAL.mute }} htmlFor="lib-save-name">
            현재 견적 저장
          </label>
          <div className="flex gap-1.5">
            <input
              id="lib-save-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              placeholder="견적 이름 (예: 서울 시티투어 2026 봄)"
              className="flex-1 rounded-lg border px-2 py-2 text-sm"
              style={{ borderColor: PAL.line, color: PAL.ink }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSave(name); } }}
            />
            <button
              type="button"
              onClick={() => onSave(name)}
              className="shrink-0 rounded-lg px-3 py-2 text-xs font-bold text-white"
              style={{ backgroundColor: PAL.violet }}
            >
              💾 저장
            </button>
          </div>
          <p className="mt-1 text-[10px]" style={{ color: PAL.mute }}>
            이 브라우저(localStorage)에 보관됩니다. 최대 {LIBRARY_MAX}건. 같은 이름도 별도 저장됩니다.
          </p>
        </div>

        {/* 저장된 목록 */}
        <div className="flex min-h-0 flex-1 flex-col">
          <p className="mb-2 text-xs font-bold" style={{ color: PAL.mute }}>저장된 견적 ({items.length}건)</p>
          {items.length === 0 ? (
            <div
              className="rounded-lg border border-dashed p-4 text-center text-xs"
              style={{ borderColor: PAL.line, color: PAL.mute }}
            >
              저장된 견적이 없습니다. 위에서 이름을 붙여 저장하면 여기에 쌓입니다.
            </div>
          ) : (
            <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto">
              {items.map((it) => (
                <li key={it.id} className="rounded-lg border p-2.5" style={{ borderColor: PAL.line }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold" style={{ color: PAL.ink }}>{it.name}</div>
                      <div className="mt-0.5 text-[11px]" style={{ color: PAL.mute }}>
                        {it.summary.packageName || '(상품명 없음)'} · {it.summary.partyTotal}명 · 일정 {it.summary.stops}건 · {fmtWon(it.summary.salePrice)}
                      </div>
                      <div className="text-[10px]" style={{ color: PAL.mute }}>{fmtDate(it.savedAt)}</div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => onLoad(it)}
                        className="rounded-lg px-2.5 py-1 text-xs font-bold text-white"
                        style={{ backgroundColor: PAL.teal }}
                      >
                        불러오기
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(it.id)}
                        className="rounded-lg border px-2 py-1 text-xs font-bold"
                        style={{ borderColor: PAL.line, color: PAL.rose }}
                        aria-label={`${it.name} 삭제`}
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
