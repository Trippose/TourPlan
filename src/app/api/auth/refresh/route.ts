// 토큰 슬라이딩 갱신 — 유효한 토큰이면 새 토큰(만료 1시간 연장)으로 세션 쿠키를 재설정한다.
// 클라이언트(AuthKeepAlive)가 활동 중 주기적으로 호출해 로그인을 유지한다.
// 1시간 무활동이면 호출이 끊겨 토큰이 만료되고, 다음 요청에서 /login으로 보내진다.
import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, readAuthConfig, signAuthToken, verifyAuthToken } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const cfg = readAuthConfig();
  if (!cfg) {
    return NextResponse.json({ success: false, error: 'auth-not-configured' }, { status: 500 });
  }
  const token = req.cookies.get(AUTH_COOKIE)?.value;
  if (!(await verifyAuthToken(cfg.secret, token))) {
    return NextResponse.json({ success: false, error: 'invalid' }, { status: 401 });
  }
  const fresh = await signAuthToken(cfg.secret);
  const res = NextResponse.json({ success: true, mode: 'refreshed' });
  res.cookies.set(AUTH_COOKIE, fresh, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
  return res;
}
