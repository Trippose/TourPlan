// 투어패키지 상품 보관함 모달 — 현재 견적을 이름 + 4자리 비밀번호로 저장 + 목록에서 불러오기·삭제
// localStorage 기반(외부 전송 0). 비밀번호(숫자 4자리)는 삭제 보호용 — 아이디·비번을 공유한
// 사람이 제작자의 견적을 함부로 지우지 못하게 한다(불러오기는 자유). 비밀번호는 SHA-256 해시로만 저장.
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
  onSave: (name: string, pin: string) => void;
  onLoad: (item: LibraryItem, pin: string) => void;
  onDelete: (id: string, pin: string) => void;
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
const onlyDigits4 = (s: string) => s.replace(/\D/g, '').slice(0, 4);

export function LibraryModal({ open, onClose, items, currentName, onSave, onLoad, onDelete, onNew }: Props) {
  const [name, setName] = useState(currentName);
  const [pin, setPin] = useState(''); // 저장용 4자리 비밀번호
  const [deletingId, setDeletingId] = useState<string | null>(null); // 삭제 PIN 입력 중인 항목
  const [deletePin, setDeletePin] = useState('');
  const [loadingId, setLoadingId] = useState<string | null>(null); // 불러오기 PIN 입력 중인 항목
  const [loadPin, setLoadPin] = useState('');

  // 열릴 때마다 현재 패키지명을 기본 저장 이름으로 채우고 입력 상태 초기화
  useEffect(() => {
    if (open) {
      setName(currentName);
      setPin('');
      setDeletingId(null);
      setDeletePin('');
      setLoadingId(null);
      setLoadPin('');
    }
  }, [open, currentName]);

  // ESC로 닫기
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const canSave = name.trim().length > 0 && /^\d{4}$/.test(pin);
  const handleSave = () => {
    if (!canSave) return;
    onSave(name, pin);
    setPin('');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="투어패키지 상품 보관함"
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
            <span>투어패키지 상품 보관함</span>
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

        {/* 현재 견적 저장 — 이름 + 4자리 비밀번호 */}
        <div className="mb-4 rounded-lg border p-3" style={{ borderColor: PAL.line }}>
          <label className="mb-1 block text-xs font-bold" style={{ color: PAL.mute }} htmlFor="lib-save-name">
            현재 상품 저장
          </label>
          <div className="flex flex-wrap gap-1.5">
            <input
              id="lib-save-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              placeholder="상품 이름 (예: 서울 시티투어 2026 봄)"
              className="min-w-0 flex-1 rounded-lg border px-2 py-2 text-sm"
              style={{ borderColor: PAL.line, color: PAL.ink }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSave(); } }}
            />
            <input
              id="lib-save-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(onlyDigits4(e.target.value))}
              maxLength={4}
              placeholder="비번 4자리"
              aria-label="저장 비밀번호 (숫자 4자리)"
              className="w-24 rounded-lg border px-2 py-2 text-center text-sm tabular-nums"
              style={{ borderColor: PAL.line, color: PAL.ink }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSave(); } }}
            />
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              className="shrink-0 rounded-lg px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
              style={{ backgroundColor: PAL.violet }}
            >
              💾 저장
            </button>
          </div>
          <p className="mt-1 text-[10px]" style={{ color: PAL.mute }}>
            이 브라우저(localStorage)에 보관됩니다. 최대 {LIBRARY_MAX}건. <strong style={{ color: PAL.rose }}>숫자 4자리 비밀번호</strong>를 설정하면, 같은 기기를 공유한 사람도 이 비밀번호 없이는 삭제할 수 없습니다 (불러오기는 자유).
          </p>
        </div>

        {/* 저장된 목록 */}
        <div className="flex min-h-0 flex-1 flex-col">
          <p className="mb-2 text-xs font-bold" style={{ color: PAL.mute }}>저장된 상품 ({items.length}건)</p>
          {items.length === 0 ? (
            <div
              className="rounded-lg border border-dashed p-4 text-center text-xs"
              style={{ borderColor: PAL.line, color: PAL.mute }}
            >
              저장된 상품이 없습니다. 위에서 이름·비밀번호를 붙여 저장하면 여기에 쌓입니다.
            </div>
          ) : (
            <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto">
              {items.map((it) => (
                <li key={it.id} className="rounded-lg border p-2.5" style={{ borderColor: PAL.line }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1 truncate text-sm font-bold" style={{ color: PAL.ink }}>
                        {it.pinHash && <span aria-label="비밀번호 보호됨" title="비밀번호로 삭제가 보호된 견적">🔒</span>}
                        <span className="truncate">{it.name}</span>
                      </div>
                      <div className="mt-0.5 text-[11px]" style={{ color: PAL.mute }}>
                        {it.summary.packageName || '(상품명 없음)'} · {it.summary.partyTotal}명 · 일정 {it.summary.stops}건 · {fmtWon(it.summary.salePrice)}
                      </div>
                      <div className="text-[10px]" style={{ color: PAL.mute }}>{fmtDate(it.savedAt)}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {deletingId === it.id ? (
                        <>
                          <input
                            type="password"
                            inputMode="numeric"
                            autoComplete="off"
                            autoFocus
                            value={deletePin}
                            onChange={(e) => setDeletePin(onlyDigits4(e.target.value))}
                            maxLength={4}
                            placeholder="비번"
                            aria-label={`${it.name} 삭제 비밀번호`}
                            className="w-16 rounded-lg border px-1.5 py-1 text-center text-xs tabular-nums"
                            style={{ borderColor: PAL.rose, color: PAL.ink }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); onDelete(it.id, deletePin); setDeletingId(null); setDeletePin(''); }
                              if (e.key === 'Escape') { setDeletingId(null); setDeletePin(''); }
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => { onDelete(it.id, deletePin); setDeletingId(null); setDeletePin(''); }}
                            className="rounded-lg px-2 py-1 text-xs font-bold text-white"
                            style={{ backgroundColor: PAL.rose }}
                          >
                            삭제
                          </button>
                          <button
                            type="button"
                            onClick={() => { setDeletingId(null); setDeletePin(''); }}
                            className="rounded-lg border px-2 py-1 text-xs font-bold"
                            style={{ borderColor: PAL.line, color: PAL.mute }}
                          >
                            취소
                          </button>
                        </>
                      ) : loadingId === it.id ? (
                        <>
                          <input
                            type="password"
                            inputMode="numeric"
                            autoComplete="off"
                            autoFocus
                            value={loadPin}
                            onChange={(e) => setLoadPin(onlyDigits4(e.target.value))}
                            maxLength={4}
                            placeholder="비번"
                            aria-label={`${it.name} 불러오기 비밀번호`}
                            className="w-16 rounded-lg border px-1.5 py-1 text-center text-xs tabular-nums"
                            style={{ borderColor: PAL.teal, color: PAL.ink }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); onLoad(it, loadPin); setLoadingId(null); setLoadPin(''); }
                              if (e.key === 'Escape') { setLoadingId(null); setLoadPin(''); }
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => { onLoad(it, loadPin); setLoadingId(null); setLoadPin(''); }}
                            className="rounded-lg px-2 py-1 text-xs font-bold text-white"
                            style={{ backgroundColor: PAL.teal }}
                          >
                            불러오기
                          </button>
                          <button
                            type="button"
                            onClick={() => { setLoadingId(null); setLoadPin(''); }}
                            className="rounded-lg border px-2 py-1 text-xs font-bold"
                            style={{ borderColor: PAL.line, color: PAL.mute }}
                          >
                            취소
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => { setLoadingId(it.id); setLoadPin(''); }}
                            className="rounded-lg px-2.5 py-1 text-xs font-bold text-white"
                            style={{ backgroundColor: PAL.teal }}
                            title={it.pinHash ? '불러오려면 비밀번호 입력' : '불러오기'}
                          >
                            불러오기
                          </button>
                          <button
                            type="button"
                            onClick={() => { setDeletingId(it.id); setDeletePin(''); }}
                            className="rounded-lg border px-2 py-1 text-xs font-bold"
                            style={{ borderColor: PAL.line, color: PAL.rose }}
                            aria-label={`${it.name} 삭제`}
                            title={it.pinHash ? '삭제하려면 비밀번호 입력' : '삭제'}
                          >
                            🗑
                          </button>
                        </>
                      )}
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
