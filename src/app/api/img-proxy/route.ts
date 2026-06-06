// 이미지 프록시 — html2canvas-pro 인쇄 캡처용. 카카오 지도 타일(mts/t1.daumcdn.net)은
// CORS(Access-Control-Allow-Origin) 헤더가 없어 클라이언트 canvas 캡처가 차단된다.
// 서버가 타일을 대신 fetch(서버 outbound는 CORS 무관)해 base64 data URL(text)로 반환하면
// html2canvas-pro가 same-origin 응답으로 받아 캡처에 그릴 수 있다.
// 보안: 카카오 계열 도메인만 화이트리스트(SSRF 차단).
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

// 카카오 지도 타일·자산 도메인만 허용 (daumcdn.net / kakao.com 서브도메인)
const ALLOWED_HOST = /(?:^|\.)daumcdn\.net$|(?:^|\.)kakao\.com$/i;

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) return new Response('missing url', { status: 400 });

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return new Response('bad url', { status: 400 });
  }
  if (!ALLOWED_HOST.test(host)) {
    return new Response('forbidden host', { status: 403 });
  }

  try {
    const upstream = await fetch(url, { cache: 'no-store' });
    if (!upstream.ok) return new Response(`upstream ${upstream.status}`, { status: 502 });
    const contentType = upstream.headers.get('content-type') || 'image/png';
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    // 이미지 바이너리를 same-origin으로 반환 → html2canvas onclone에서 타일 img src를 이 경로로
    // 교체하면 CORS 없이 캡처된다. ACAO도 부여해 useCORS 경로에서도 안전.
    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return new Response('fetch failed', { status: 502 });
  }
}
