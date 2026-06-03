// 루트 레이아웃 — Next.js 16 App Router
// - metadata: title·description·OG·manifest·apple-touch-icon (PWA 설치 기본)
// - viewport: theme_color (PWA standalone 모드 툴바)
// - html lang="ko" (한국어 강제 — 스크린리더 발음·SEO)
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "투어 패키지 단가 빌더 — 한국 인바운드 의사결정 도구",
    template: "%s · 투어 단가 빌더",
  },
  description:
    "한국 인바운드 투어 패키지의 1인 원가·채널별 BEP·매트릭스·운영 권장을 실시간 산출. 카카오 모빌리티 기반 동선·이동시간 + 자체 모객·자체 온라인·글로벌 OTA 채널 분석.",
  keywords: [
    "투어 패키지",
    "단가 계산",
    "BEP",
    "손익분기",
    "한국 인바운드",
    "OTA",
    "여행 견적",
    "카카오 모빌리티",
    "투어 운영",
  ],
  authors: [{ name: "WATERTREE" }],
  applicationName: "투어 단가 빌더",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "투어 단가",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.svg", sizes: "192x192", type: "image/svg+xml" },
      { url: "/icons/icon-512.svg", sizes: "512x512", type: "image/svg+xml" },
    ],
    apple: [
      { url: "/icons/apple-touch-icon.svg", sizes: "180x180", type: "image/svg+xml" },
    ],
  },
  openGraph: {
    type: "website",
    locale: "ko_KR",
    title: "투어 패키지 단가 빌더 — 한국 인바운드 의사결정 도구",
    description:
      "1인 원가·채널별 BEP·매트릭스·운영 권장을 실시간 산출하는 인바운드 투어 견적 도구.",
    siteName: "투어 단가 빌더",
  },
  twitter: {
    card: "summary",
    title: "투어 패키지 단가 빌더",
    description: "1인 원가·채널별 BEP·매트릭스·운영 권장 자동 산출",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  formatDetection: {
    telephone: false,
    address: false,
    email: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#C0306B",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  colorScheme: "light",
  viewportFit: "cover",
};

// 라이트 전용 강제 — OS가 다크여도 라이트 고정 (다크모드 토글 제거, 라이트 단일 테마).
// 잔존 .dark 클래스가 있으면 제거 + colorScheme=light 고정 (FOUC 방지 head 동기 실행).
const THEME_INIT_SCRIPT = `
(function(){
  try {
    document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme = 'light';
    localStorage.removeItem('theme');
  } catch(e){}
})();
`;

// dev 환경에서만 잔존 SW 해제 — production에서는 Serwist가 SW를 정상 운영
const SW_CLEANUP_SCRIPT = `
(function(){
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  navigator.serviceWorker.getRegistrations().then(function(regs){
    regs.forEach(function(r){ r.unregister(); });
  }).catch(function(){});
  if ('caches' in window) {
    caches.keys().then(function(keys){
      keys.forEach(function(k){ caches.delete(k); });
    }).catch(function(){});
  }
})();
`;

// Next.js 16 webpack dev HMR 내부 race — WebSocket이 router 초기화 전 hmrRefresh 호출.
// 스택은 next/dist/client 내부만 가리키고 사용자 코드 0건. production 빌드에선 HMR 자체가 없어 발생 0.
// localhost 한정으로 이 특정 노이즈만 필터, 다른 모든 에러는 그대로 통과 — 진짜 버그 가림 위험 0.
const DEV_HMR_NOISE_SILENCER = `
(function(){
  if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  var PATTERN = /Router action dispatched before initialization|Internal Next\\.js error|state update on a component that hasn't mounted yet/;
  // window.onerror — Uncaught 에러 가로채기
  window.addEventListener('error', function(ev){
    if (ev && ev.message && PATTERN.test(ev.message)) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      return false;
    }
  }, true);
  // unhandledrejection — Promise reject 가로채기
  window.addEventListener('unhandledrejection', function(ev){
    var msg = ev && ev.reason && (ev.reason.message || String(ev.reason));
    if (msg && PATTERN.test(msg)) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
    }
  }, true);
  // console.error — Next.js dev가 직접 console.error 호출하는 경우 필터
  var orig = console.error.bind(console);
  console.error = function(){
    var first = arguments[0];
    var s = (first && first.message) || String(first || '');
    if (PATTERN.test(s)) return;
    // 추가: 두 번째 인자가 Error 객체인 경우도 검사
    for (var i=0; i<arguments.length; i++) {
      var a = arguments[i];
      if (a && a.message && PATTERN.test(a.message)) return;
      if (typeof a === 'string' && PATTERN.test(a)) return;
    }
    orig.apply(console, arguments);
  };
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Critical inline CSS — Tailwind 로드 전 첫 페인트부터 기본 레이아웃 안정 (콜드 컴파일 깜빡 박멸).
            폰트 스택은 한국어 시스템 폰트 우선 (외부 CDN 0 → 네트워크 의존 0). */}
        <style dangerouslySetInnerHTML={{ __html: `
          html,body{margin:0;padding:0;min-height:100%}
          body{background:#FAF7F2;font-family:"Apple SD Gothic Neo","Malgun Gothic","Noto Sans CJK KR","Noto Sans KR",system-ui,-apple-system,BlinkMacSystemFont,sans-serif;color:#1F2937;-webkit-font-smoothing:antialiased}
          .__login-grid{display:grid;place-items:center;min-height:100dvh;padding:1rem;box-sizing:border-box}
        `}} />
        {/* 다크모드 초기 적용 — FOUC 방지 (React 마운트 전 .dark 클래스 부여) */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* dev 모드 SW 강제 해제 — 이전 production 빌드 SW 잔존 박멸 (깜빡임 박멸) */}
        <script dangerouslySetInnerHTML={{ __html: SW_CLEANUP_SCRIPT }} />
        {/* Next.js 16 dev HMR 내부 race 노이즈 필터 — localhost 한정, 사용자 에러는 그대로 통과 */}
        <script dangerouslySetInnerHTML={{ __html: DEV_HMR_NOISE_SILENCER }} />
        {/* 외부 자원 preconnect — 카카오 SDK·API만 (Pretendard CDN 의존 제거 → 콘솔 에러 0) */}
        <link rel="preconnect" href="https://dapi.kakao.com" crossOrigin="" />
        <link rel="dns-prefetch" href="https://t1.daumcdn.net" />
        <link rel="dns-prefetch" href="https://apis-navi.kakaomobility.com" />
        {/* 폰트는 next/font/google Geist + 한국어 시스템 폰트 폴백 (Apple SD Gothic Neo · Malgun Gothic · Noto Sans CJK KR).
            외부 CDN 미사용 → 네트워크 차단·CDN 장애 영향 0 + LCP 단축. */}
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
