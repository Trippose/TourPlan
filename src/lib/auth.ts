// 단일 게이트 인증 — 두 비밀번호(PW1·PW2) 모두 일치 시 HMAC 서명 쿠키 발급
// 서버 전용 (Edge runtime 호환 — Web Crypto 사용)
//
// 쿠키 값 형식: "{exp}.{signature_hex}"
//   - exp        : 만료 Unix epoch ms
//   - signature  : HMAC-SHA256(exp_string, AUTH_SECRET) hex 인코딩
//
// 검증 단계:
//   1. exp · signature 분리
//   2. 현재 시각이 exp 이전인지 확인 (만료 검사)
//   3. signature 재계산 후 timing-safe 비교 (위변조 방지)

export const AUTH_COOKIE = 'tour-pricing-auth';
// 유휴 1시간 자동 로그아웃 — 토큰 수명을 1시간으로 두고, 활동 중이면 클라이언트가 슬라이딩 갱신한다.
// 1시간 무활동이면 토큰이 만료돼 다음 요청에서 /login으로 보내진다. 쿠키는 세션 쿠키(브라우저 종료 시 삭제).
export const AUTH_TTL_MS = 60 * 60 * 1000; // 1시간

// Web Crypto 기반 HMAC-SHA256 — Edge runtime · Node 양쪽 모두 동작
async function hmac(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// 상수시간 문자열 비교 — 타이밍 어택 방지
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function signAuthToken(secret: string, ttlMs = AUTH_TTL_MS): Promise<string> {
  const exp = Date.now() + ttlMs;
  const expStr = String(exp);
  const sig = await hmac(secret, expStr);
  return `${expStr}.${sig}`;
}

export async function verifyAuthToken(secret: string, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return false;

  const expStr = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= Date.now()) return false; // 만료

  const expected = await hmac(secret, expStr);
  return timingSafeEqualHex(sig, expected);
}

// 환경변수 검증 — 누락·기본값 사용 시 명시적 오류
export function readAuthConfig(): { pw1: string; pw2: string; secret: string } | null {
  const pw1 = process.env.AUTH_PW1;
  const pw2 = process.env.AUTH_PW2;
  const secret = process.env.AUTH_SECRET;
  if (!pw1 || !pw2 || !secret) return null;
  if (pw1.length < 4 || pw2.length < 4 || secret.length < 16) return null;
  return { pw1, pw2, secret };
}

// 상수시간 바이트 비교 (Edge·Node 모두 동작 — Buffer 미사용)
function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// 사용자 입력 비밀번호 2개 모두 일치하는지 (timing-safe, early-return 회피)
export function comparePasswords(input1: string, input2: string, pw1: string, pw2: string): boolean {
  const enc = new TextEncoder();
  const ok1 = timingSafeEqualBytes(enc.encode(input1), enc.encode(pw1));
  const ok2 = timingSafeEqualBytes(enc.encode(input2), enc.encode(pw2));
  return ok1 && ok2;
}
