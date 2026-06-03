// 인증 게이트 — Next.js 16 'proxy' 컨벤션 (구 middleware 마이그레이션)
// 보호 경로 접근 시 쿠키 검증, 미인증이면 /login 으로 리다이렉트
// 제외: /login, /api/auth/*, 정적 자원, PWA 메타, manifest, offline
//
// Edge runtime 동작 — Web Crypto 만 사용 (auth.ts hmac 함수)
import { NextResponse, type NextRequest } from 'next/server';
import { AUTH_COOKIE, verifyAuthToken } from '@/lib/auth';

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 보호 제외 경로 — 인증 게이트를 통과시킬 경로
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/icons/') ||
    pathname === '/sw.js' ||
    pathname === '/manifest.webmanifest' ||
    pathname === '/favicon.ico' ||
    pathname === '/robots.txt' ||
    pathname === '/~offline'
  ) {
    return NextResponse.next();
  }

  // 환경변수 미설정 시 — 운영자가 .env.local 설정 전 모든 요청을 /login 으로 보내 안내
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('reason', 'not-configured');
    return NextResponse.redirect(url);
  }

  // 쿠키 검증
  const token = req.cookies.get(AUTH_COOKIE)?.value;
  const ok = await verifyAuthToken(secret, token);
  if (!ok) {
    // API 경로는 JSON 401 — HTML redirect 시 fetch 클라이언트가 파싱 실패
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { success: false, error: 'unauthorized', hint: '세션이 만료되었습니다. 다시 로그인해주세요.' },
        { status: 401 },
      );
    }
    // 페이지 요청은 /login으로 리다이렉트
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    if (pathname !== '/') url.searchParams.set('from', pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

// matcher — proxy 실행 대상 경로
// 모든 경로 매칭 후 함수 내에서 제외 처리 (단순함 + 유지보수 우선)
export const config = {
  matcher: [
    // _next/static·_next/image·정적 파일(확장자) 제외
    '/((?!_next/static|_next/image|.*\\..*).*)',
  ],
};
