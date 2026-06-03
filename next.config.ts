// Next.js 16 + Serwist v9 PWA 설정
// - 서비스워커: src/app/sw.ts
// - 매니페스트: src/app/manifest.ts (동적)
// - 오프라인 폴백: src/app/~offline/page.tsx
// - 개발 모드에서는 SW 비활성 (HMR 충돌 방지)
import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV !== "production",
  cacheOnNavigation: true,
  // reloadOnOnline: 네트워크 ping마다 자동 reload → 무한 깜빡임 유발. 사용자가 명시적으로 새로고침할 때만.
  reloadOnOnline: false,
});

// Content Security Policy — XSS 방어 + 외부 리소스 화이트리스트
// 카카오 SDK·jsdelivr 폰트만 허용, 임의 외부 스크립트·iframe 차단.
// 'unsafe-inline'/'unsafe-eval'은 Next.js 런타임·카카오 SDK 요구. 완전 제거는 nonce 도입 필요(작업 큼).
const CSP_DIRECTIVES = [
  "default-src 'self'",
  // 카카오 maps SDK: dapi.kakao.com(https)으로 진입 후 services·지도 서브리소스를 t1.daumcdn.net에서 로드한다.
  // dev(http://localhost)에선 카카오 SDK가 현재 프로토콜(http)로 서브스크립트를 받으므로 http://t1.daumcdn.net 허용이 필요하다.
  // (실측: services 스크립트가 http://t1.daumcdn.net/mapjsapi/...kakao.js 로 로드돼 CSP https-only에 차단됨.)
  // 프로덕션(https)에선 카카오가 https://t1.daumcdn.net 을 사용하므로 http 항목은 dev 전용 안전망이다(mixed-content로 프로덕션 무영향).
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://dapi.kakao.com https://t1.daumcdn.net http://t1.daumcdn.net",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https://t1.daumcdn.net https://*.daumcdn.net https://*.kakao.com http://t1.daumcdn.net http://*.daumcdn.net",
  // 카카오 장소·주소 검색(Places.keywordSearch)은 dev(http)에서 http://dapi.kakao.com 으로 XHR 한다(실측: [FAILED] csp).
  // → http://dapi.kakao.com 허용 필요. 프로덕션(https)에선 https://dapi.kakao.com 사용(둘 다 허용).
  "connect-src 'self' https://dapi.kakao.com http://dapi.kakao.com https://apis-navi.kakaomobility.com https://t1.daumcdn.net http://t1.daumcdn.net",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  // upgrade-insecure-requests 제거 — localhost HTTP fetch 차단 유발.
  // HTTPS 강제는 HSTS 헤더(이미 적용)와 운영 환경의 LB/CDN에서 처리.
].join('; ');

const nextConfig: NextConfig = {
  // 성능 최적화
  compress: true,                   // gzip/brotli 응답 압축
  poweredByHeader: false,           // X-Powered-By 제거 (보안 + 응답 크기)
  // ETag 비활성 — HTML 응답에 ETag 미부착 → 304 분기 제거 → "새로고침 없이 최신 반영"
  generateEtags: false,
  // reactStrictMode 비활성 — dev에서 모든 컴포넌트를 mount→unmount→remount 2회 실행.
  // dynamic ssr:false 컴포넌트와 결합 시 placeholder→real→unmount→placeholder→real 무한 사이클 = 깜빡임.
  // production 빌드에선 strict mode 자동 비활성이므로 보안·동작 영향 없음.
  reactStrictMode: false,
  // dev indicator 비활성 — 좌하단 "N" 패널·Compiling 표시·Route info 패널
  // (페이지 layout flex 컨테이너에 inject되어 form 위치 흔들림 + 컴파일 깜빡임 시각 유발)
  devIndicators: false,
  // 소스맵 외부 노출 차단 — production 빌드에서 .map 파일을 클라이언트에 배포하지 않음
  productionBrowserSourceMaps: false,
  experimental: {
    // tree-shaking 강화 — 사용 안 하는 lucide·shadcn 컴포넌트 자동 제거
    optimizePackageImports: ['lucide-react', '@base-ui/react'],
  },
  // dev 파일 watcher 제외 — Playwright 산출물(.playwright-mcp/*.log·*.png)·백업·임시 파일이
  // 실시간 변경될 때 Fast Refresh가 full-reload를 무한 반복(페이지 깜빡임)하는 것을 차단한다.
  // (실측: console-*.log 가 reload마다 추가→watcher 감지→reload 루프. dev 전용, 빌드 영향 0.)
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...(config.watchOptions ?? {}),
        ignored: [
          '**/.git/**',
          '**/node_modules/**',
          '**/.next/**',
          '**/.playwright-mcp/**',
          '**/*.bak-bom',
          '**/.tmp-*',
        ],
      };
    }
    return config;
  },
  // 정적 자원 캐시 (production)
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
          // HSTS — HTTPS 강제 1년 + 서브도메인 포함 (프로덕션 HTTPS 배포 시 활성)
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          // CSP — XSS·인젝션·iframe 클릭재킹 방어
          { key: "Content-Security-Policy", value: CSP_DIRECTIVES },
        ],
      },
      {
        // 서비스워커는 항상 최신 — no-store
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-store, no-cache, must-revalidate" }],
      },
      {
        // 로그인·메인 HTML 페이지는 캐시 금지 — 매 요청 최신 (인증·세션 상태 반영)
        source: "/((?!_next|api|icons|.*\\.).*)",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, max-age=0" },
          { key: "Pragma", value: "no-cache" },
        ],
      },
      {
        // manifest·매니페스트 — 짧은 캐시 (5분) + 변경 시 즉시 갱신 가능
        source: "/manifest.webmanifest",
        headers: [{ key: "Cache-Control", value: "public, max-age=300, must-revalidate" }],
      },
      {
        // 아이콘은 1년 immutable 캐시 (해시 변경되면 새 파일)
        source: "/icons/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default withSerwist(nextConfig);
