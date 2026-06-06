// 인증 로그인 — POST { pw1, pw2 } → HMAC 서명 쿠키 발급
// 보안:
//   1. Zod strict 검증 (길이 1~128, 추가 필드 거부)
//   2. IP rate limit (분당 5회 — security.md 권장)
//   3. comparePasswords 타이밍-세이프
//   4. 실패 응답 시간 균일화 (타이밍 어택 추가 방어)
//   5. HttpOnly · Secure(prod) · SameSite=Lax 쿠키

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  AUTH_COOKIE,
  comparePasswords,
  readAuthConfig,
  signAuthToken,
} from '@/lib/auth';

export const runtime = 'nodejs';

const BodySchema = z
  .object({
    pw1: z.string().min(1).max(128),
    pw2: z.string().min(1).max(128),
  })
  .strict();

// IP slide window — 분당 5회 (로그인 brute-force 차단)
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 5;
const loginBuckets = new Map<string, number[]>();

function checkRate(ip: string): { ok: boolean; retryAfter?: number } {
  const now = Date.now();
  const windowStart = now - RATE_WINDOW_MS;
  const bucket = (loginBuckets.get(ip) ?? []).filter((t) => t > windowStart);
  if (bucket.length >= RATE_MAX) {
    const earliest = bucket[0];
    return { ok: false, retryAfter: Math.ceil((earliest + RATE_WINDOW_MS - now) / 1000) };
  }
  bucket.push(now);
  loginBuckets.set(ip, bucket);
  return { ok: true };
}

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

// 실패 응답 균일화 — 비교 실패·환경변수 누락 모두 동일 지연
async function delayedFail(): Promise<NextResponse> {
  await new Promise((r) => setTimeout(r, 250));
  return NextResponse.json({ success: false, error: 'invalid' }, { status: 401 });
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rate = checkRate(ip);
  if (!rate.ok) {
    return NextResponse.json(
      { success: false, error: 'rate-limited', retryAfter: rate.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfter ?? 60) } },
    );
  }

  // Zod 입력 검증
  let body: { pw1: string; pw2: string };
  try {
    const raw = await req.json();
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) return delayedFail();
    body = parsed.data;
  } catch {
    return delayedFail();
  }

  // 환경변수 누락 시 명시적 500 (운영자 알림)
  const cfg = readAuthConfig();
  if (!cfg) {
    return NextResponse.json(
      {
        success: false,
        error: 'auth-not-configured',
        hint: '.env.local 에 AUTH_PW1·AUTH_PW2·AUTH_SECRET 설정 필요 (각각 4자·4자·16자 이상)',
      },
      { status: 500 },
    );
  }

  // timing-safe 비교
  const ok = comparePasswords(body.pw1, body.pw2, cfg.pw1, cfg.pw2);
  if (!ok) return delayedFail();

  // 서명 토큰 발급 + 세션 쿠키 설정 (maxAge 미설정 = 세션 쿠키 → 브라우저 종료 시 삭제).
  // 토큰 자체의 만료(AUTH_TTL_MS=1시간)가 유휴 로그아웃을 강제하고, 활동 중엔 클라이언트가 슬라이딩 갱신한다.
  const token = await signAuthToken(cfg.secret);
  const res = NextResponse.json({ success: true, mode: 'authenticated' });
  res.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
  return res;
}
