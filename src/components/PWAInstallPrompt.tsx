// PWA 설치 안내 — beforeinstallprompt 이벤트 캡처 후 사용자 명시 클릭 시 prompt
// iOS Safari는 prompt 미지원 → "홈 화면에 추가" 안내 텍스트 분기 표시
'use client';

import { useEffect, useState } from 'react';

interface BIPEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function PWAInstallPrompt() {
  const [event, setEvent] = useState<BIPEvent | null>(null);
  const [isIos, setIsIos] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // 이미 standalone 모드면 설치 완료 — 버튼 숨김
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      // iOS Safari
      ('standalone' in window.navigator && (window.navigator as { standalone?: boolean }).standalone === true);
    if (standalone) setInstalled(true);

    // iOS 감지 (iPad·iPhone·iPod, 단 iPadOS 13+는 Mac으로 위장 가능)
    const ua = window.navigator.userAgent.toLowerCase();
    const ios = /iphone|ipad|ipod/.test(ua) || (ua.includes('mac') && 'ontouchend' in document);
    setIsIos(ios);

    const handler = (e: Event) => {
      e.preventDefault();
      setEvent(e as BIPEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    const installedHandler = () => setInstalled(true);
    window.addEventListener('appinstalled', installedHandler);
    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', installedHandler);
    };
  }, []);

  if (installed) return null;

  // iOS — beforeinstallprompt 미발화. 안내 토글
  if (isIos && !event) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIosHint((s) => !s)}
          className="inline-flex items-center justify-center gap-1 rounded-lg border bg-white px-2 text-xs font-bold transition hover:scale-105 dark:bg-neutral-800 dark:text-neutral-100"
          style={{ borderColor: 'var(--border, #E7E2D5)', minWidth: 36, minHeight: 36, color: '#C0306B' }}
          aria-label="iOS 설치 안내"
          title="iOS 홈 화면에 추가하는 방법"
        >
          <span aria-hidden>📲</span>
          <span className="hidden sm:inline">설치</span>
        </button>
        {showIosHint && (
          <div
            role="dialog"
            className="absolute right-2 top-14 z-50 w-72 rounded-xl border bg-white p-3 text-xs shadow-lg dark:bg-neutral-900 dark:text-neutral-100"
            style={{ borderColor: 'var(--border, #E7E2D5)' }}
          >
            <p className="mb-1 font-bold" style={{ color: '#C0306B' }}>iOS 홈 화면에 추가</p>
            <ol className="ml-4 list-decimal space-y-1 leading-relaxed">
              <li>Safari 하단 <strong>공유 버튼</strong> 누르기</li>
              <li>스크롤해서 <strong>&quot;홈 화면에 추가&quot;</strong> 선택</li>
              <li>우상단 <strong>추가</strong> 버튼 탭</li>
            </ol>
            <p className="mt-2 text-[11px] text-neutral-500">홈 화면에서 풀스크린 앱처럼 실행됩니다.</p>
            <button
              type="button"
              onClick={() => setShowIosHint(false)}
              className="mt-2 w-full rounded-lg bg-neutral-100 px-2 py-1 text-xs font-semibold dark:bg-neutral-800"
            >
              닫기
            </button>
          </div>
        )}
      </>
    );
  }

  if (!event) return null;

  const onClick = async () => {
    try {
      await event.prompt();
      const choice = await event.userChoice;
      if (choice.outcome === 'accepted') setEvent(null);
    } catch {
      // 사용자 취소 등 — 무음 처리하지 않고 버튼 유지
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center justify-center gap-1 rounded-lg border bg-white px-2 text-xs font-bold transition hover:scale-105 dark:bg-neutral-800 dark:text-neutral-100"
      style={{ borderColor: 'var(--border, #E7E2D5)', minWidth: 36, minHeight: 36, color: '#C0306B' }}
      aria-label="이 앱 설치"
      title="홈 화면·앱 목록에 설치"
    >
      <span aria-hidden>📲</span>
      <span className="hidden sm:inline">설치</span>
    </button>
  );
}
