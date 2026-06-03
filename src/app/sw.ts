// 서비스워커 — Serwist v9 (Workbox 기반). 빌드 시 public/sw.js 로 출력.
// 캐시 전략 매핑 (Chrome for Developers / Serwist 공식 기준):
// - 인증/모빌리티 API: NetworkOnly (캐시 금지 — 응답 신선도 + 시크릿 누출 차단)
// - 문서 (HTML): NetworkFirst + 3초 타임아웃 → 캐시 폴백 + /~offline 폴백
// - 정적 자산 (JS/CSS/폰트): StaleWhileRevalidate
// - 이미지 (자체): CacheFirst + ExpirationPlugin 60건 / 30일
// - 카카오 SDK / Google Fonts: 출처별 별도 캐시명, StaleWhileRevalidate
// 출처: https://developer.chrome.com/docs/workbox/caching-strategies-overview/

import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import {
  CacheFirst,
  ExpirationPlugin,
  NetworkFirst,
  NetworkOnly,
  Serwist,
  StaleWhileRevalidate,
} from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // 1. 카카오 모빌리티·인증 API — 절대 캐시 금지 (시크릿 누출·신선도)
    {
      matcher: /^https?:\/\/[^/]+\/api\/route-time/i,
      handler: new NetworkOnly(),
    },
    {
      matcher: /^https?:\/\/[^/]+\/api\/(auth|admin|login|logout)/i,
      handler: new NetworkOnly(),
    },
    // /login HTML — 캐시 금지 (인증 우회 방지·신선도)
    {
      matcher: /^https?:\/\/[^/]+\/login(\?.*)?$/i,
      handler: new NetworkOnly(),
    },

    // 2. 카카오 SDK (외부 CDN) — StaleWhileRevalidate
    {
      matcher: /^https:\/\/dapi\.kakao\.com\/.*/i,
      handler: new StaleWhileRevalidate({
        cacheName: "kakao-sdk",
        plugins: [
          new ExpirationPlugin({ maxEntries: 4, maxAgeSeconds: 7 * 24 * 60 * 60 }),
        ],
      }),
    },
    {
      matcher: /^https:\/\/(t1|map)\.daumcdn\.net\/.*/i,
      handler: new StaleWhileRevalidate({
        cacheName: "kakao-map-tiles",
        plugins: [
          new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 24 * 60 * 60 }),
        ],
      }),
    },

    // 3. 폰트 — 1년 캐시 (CacheFirst)
    {
      matcher: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
      handler: new CacheFirst({
        cacheName: "google-fonts",
        plugins: [
          new ExpirationPlugin({ maxEntries: 8, maxAgeSeconds: 365 * 24 * 60 * 60 }),
        ],
      }),
    },

    // 4. 이미지 — CacheFirst + 만료 (자체)
    {
      matcher: ({ request, url }) =>
        request.destination === "image" && url.origin === self.origin,
      handler: new CacheFirst({
        cacheName: "images",
        plugins: [
          new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 30 * 24 * 60 * 60 }),
        ],
      }),
    },

    // 5. 정적 자산 (JS·CSS·폰트) — StaleWhileRevalidate
    {
      matcher: ({ request }) =>
        request.destination === "script" ||
        request.destination === "style" ||
        request.destination === "font",
      handler: new StaleWhileRevalidate({
        cacheName: "static-assets",
        plugins: [
          new ExpirationPlugin({ maxEntries: 80, maxAgeSeconds: 30 * 24 * 60 * 60 }),
        ],
      }),
    },

    // 6. API GET (자체) — NetworkFirst (5초)
    {
      matcher: ({ request, url }) =>
        request.method === "GET" &&
        url.origin === self.origin &&
        url.pathname.startsWith("/api/"),
      handler: new NetworkFirst({
        cacheName: "api-get",
        networkTimeoutSeconds: 5,
        plugins: [
          new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 5 * 60 }),
        ],
      }),
    },

    // 7. 문서 (HTML) — NetworkFirst + 3초 타임아웃 + 오프라인 폴백
    {
      matcher: ({ request }) => request.destination === "document",
      handler: new NetworkFirst({
        cacheName: "pages",
        networkTimeoutSeconds: 3,
        plugins: [
          new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 7 * 24 * 60 * 60 }),
        ],
      }),
    },

    // 8. defaultCache 폴백 (precache + 기본 Workbox 전략)
    ...defaultCache,
  ],
  fallbacks: {
    entries: [
      {
        url: "/~offline",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

serwist.addEventListeners();
