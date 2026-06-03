// 로그아웃 — 쿠키 즉시 삭제 (Max-Age=0)
import { NextResponse } from 'next/server';
import { AUTH_COOKIE } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST() {
  const res = NextResponse.json({ success: true, mode: 'logged-out' });
  res.cookies.set(AUTH_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return res;
}
