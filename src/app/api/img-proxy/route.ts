// 이미지 프록시 — html2canvas-pro 인쇄 캡처용. 카카오 지도 타일(mts/t1.daumcdn.net)은
// CORS(Access-Control-Allow-Origin) 헤더가 없어 클라이언트 canvas 캡처가 차단된다.
// 서버가 타일을 대신 fetch(서버 outbound는 CORS 무관)해 same-origin 이미지로 반환하면
// html2canvas-pro가 onclone에서 타일 src를 이 경로로 교체해 CORS 없이 캡처할 수 있다.
//
// 보안(SSRF/DoS/XSS 방어):
//   - 카카오 계열 도메인만 화이트리스트 + IP 리터럴·비 http(s) 거부
//   - 리다이렉트 미추적(3xx 거부) — 화이트리스트 우회 차단
//   - content-type을 raster 이미지로 화이트리스트(svg 등 스크립트 가능 타입 거부)
//   - 응답 크기 상한(10MB) + fetch 타임아웃(AbortController)
//   - nosniff·CSP 부여, ACAO는 부여하지 않음(호출자는 same-origin)
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

const ALLOWED_HOST = /(?:^|\.)daumcdn\.net$|(?:^|\.)kakao\.com$/i;
const SAFE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_BYTES = 10 * 1024 * 1024; // 지도 타일 상한 10MB
const TIMEOUT_MS = 8000;

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) return new Response('missing url', { status: 400 });

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return new Response('bad url', { status: 400 });
  }
  // http/https만 허용 (카카오 타일: dev=http, prod=https)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return new Response('bad protocol', { status: 400 });
  }
  const host = parsed.hostname;
  // IP 리터럴(IPv4·IPv6) 직접 지정 차단 — 내부망 우회 방지
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':')) {
    return new Response('ip host not allowed', { status: 403 });
  }
  if (!ALLOWED_HOST.test(host)) {
    return new Response('forbidden host', { status: 403 });
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    // 리다이렉트 미추적 — 화이트리스트는 최초 URL에만 적용되므로 3xx로 내부 IP 우회를 차단
    const upstream = await fetch(parsed.href, {
      cache: 'no-store',
      redirect: 'manual',
      signal: ctrl.signal,
    });
    if (upstream.status === 0 || (upstream.status >= 300 && upstream.status < 400)) {
      return new Response('redirect not allowed', { status: 502 });
    }
    if (!upstream.ok) return new Response(`upstream ${upstream.status}`, { status: 502 });

    // content-type 화이트리스트 — raster 이미지만(svg·html 등 스크립트 실행 가능 타입 거부)
    const contentType = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!SAFE_TYPES.has(contentType)) {
      return new Response('unsupported content-type', { status: 415 });
    }
    // 크기 상한 — Content-Length 선검사 후 본문 크기 재확인(메모리 DoS 방지)
    const declared = Number(upstream.headers.get('content-length') || '0');
    if (Number.isFinite(declared) && declared > MAX_BYTES) {
      return new Response('too large', { status: 413 });
    }
    const buf = await upstream.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      return new Response('too large', { status: 413 });
    }

    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; sandbox",
      },
    });
  } catch {
    return new Response('fetch failed', { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
