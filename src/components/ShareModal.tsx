// 견적 공유 모달 — 현재 상태를 URL fragment(#)에 base64로 인코딩 + QR 코드 PNG 생성
// fragment 사용으로 서버 전송·로그 노출 방지 (개인정보 미전송)
// QR은 qrcode 패키지로 클라이언트 PNG(data URL) 생성 — 외부 CDN 의존 0
'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

const PAL = {
  bg: '#FAF7F2',
  line: '#E7E2D5',
  ink: '#1F2937',
  mute: '#52606D',
  violet: '#6E37CC',
  violetPale: '#E4DCF6',
  teal: '#0F807A',
  tealPale: '#CCEDEB',
  emerald: '#138060',
  emeraldPale: '#CDEDDB',
};

interface Props {
  open: boolean;
  onClose: () => void;
  payload: Record<string, unknown>;
}

// QR은 qrcode 패키지(BSD)로 클라이언트 PNG(data:image/png) 생성. CDN 의존 0, 오프라인 동작.

function encodePayload(payload: Record<string, unknown>): string {
  try {
    const json = JSON.stringify(payload);
    // UTF-8 → base64 (한국어 안전)
    const bytes = new TextEncoder().encode(json);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch {
    return '';
  }
}

export function ShareModal({ open, onClose, payload }: Props) {
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrErr, setQrErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (typeof window === 'undefined') return;
    const encoded = encodePayload(payload);
    const base = `${window.location.origin}${window.location.pathname}`;
    const fullUrl = `${base}#q=${encoded}`;
    setUrl(fullUrl);
    setCopied(false);
    setQrErr(null);
    // QR PNG data URL 클라이언트 생성 (외부 CDN 의존 0 + dangerouslySetInnerHTML 회피)
    // data:image/png;base64,... 형식이라 <img src>에 안전하게 주입 가능 (XSS 벡터 0)
    QRCode.toDataURL(fullUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 240,
      color: { dark: '#1F2937', light: '#FFFFFF' },
    })
      .then((dataUrl) => setQrDataUrl(dataUrl))
      .catch((err) => {
        setQrErr(
          err instanceof Error
            ? `QR 생성 실패: ${err.message} (URL 길이 ${fullUrl.length}자 — QR 한계 약 2,953자 초과 가능)`
            : '알 수 없는 오류',
        );
        setQrDataUrl('');
      });
  }, [open, payload]);

  // ESC로 닫기
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 실패 — 사용자가 수동 복사
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="견적 URL·QR 공유"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl dark:bg-neutral-900 dark:text-neutral-100"
        style={{ border: '1px solid var(--border, ' + PAL.line + ')' }}
      >
        <header className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-black tracking-tight">
            <span aria-hidden>🔗</span>
            <span>견적 URL · QR 공유</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border px-2 py-1 text-xs font-bold"
            style={{ borderColor: PAL.line }}
            aria-label="공유 모달 닫기"
          >
            ✕
          </button>
        </header>

        <div className="mb-3 rounded-lg border-l-4 px-3 py-2 text-xs leading-relaxed"
          style={{ borderColor: PAL.teal, backgroundColor: PAL.tealPale, color: PAL.teal }}
        >
          <strong>안내</strong> — 현재 입력값이 URL fragment(#)에 인코딩됩니다. 서버 전송·로그 노출 0건. 다른 기기에서 링크 열면 입력값 자동 복원.
        </div>

        <div className="mb-3">
          <label className="mb-1 block text-xs font-bold" style={{ color: PAL.mute }}>공유 URL ({url.length} bytes)</label>
          <div className="flex gap-1.5">
            <input
              type="text"
              readOnly
              value={url}
              className="flex-1 rounded-lg border px-2 py-2 text-xs font-mono dark:bg-neutral-800 dark:text-neutral-100"
              style={{ borderColor: PAL.line }}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="공유 URL"
            />
            <button
              type="button"
              onClick={copyUrl}
              className="rounded-lg px-3 py-2 text-xs font-bold text-white"
              style={{ backgroundColor: copied ? PAL.emerald : PAL.teal }}
              aria-label="URL 복사"
            >
              {copied ? '✓ 복사됨' : '📋 복사'}
            </button>
          </div>
        </div>

        <div className="mb-3">
          <p className="mb-2 text-xs font-bold" style={{ color: PAL.mute }}>QR 코드 (클라이언트 PNG 생성 · 외부 의존 0)</p>
          <div className="flex items-start gap-3">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="견적 URL QR 코드"
                width={180}
                height={180}
                className="rounded-lg border"
                style={{ borderColor: PAL.line, backgroundColor: 'white' }}
              />
            ) : qrErr ? (
              <div
                className="flex items-center justify-center rounded-lg border bg-yellow-50 p-2 text-[11px]"
                style={{ borderColor: PAL.line, color: '#A38420', width: 180, height: 180 }}
                role="alert"
              >
                ⚠ {qrErr}
              </div>
            ) : (
              <div
                className="flex items-center justify-center rounded-lg border bg-neutral-50 p-2"
                style={{ borderColor: PAL.line, width: 180, height: 180 }}
              >
                <span className="text-xs" style={{ color: PAL.mute }}>QR 생성 중…</span>
              </div>
            )}
            <p className="text-[11px] leading-relaxed" style={{ color: PAL.mute }}>
              모바일 카메라로 QR 스캔 → 견적 URL 자동 열림. QR 표준 한계 약 2,953자(M 오류복원), 현재 URL <strong>{url.length}자</strong>{' '}
              {url.length > 2500 && <span style={{ color: '#A38420' }}>(스캔 실패 가능)</span>}.
            </p>
          </div>
        </div>

        <p className="text-[10px]" style={{ color: PAL.mute }}>
          ⚠ 공유 URL은 입력값 전체를 포함합니다. 고객사·연락처 등 개인정보가 입력돼 있으면 공유 전 확인하세요. URL fragment는 서버로 전송되지 않습니다.
        </p>
      </div>
    </div>
  );
}
