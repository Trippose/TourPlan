// 카카오 모빌리티 길찾기 API 프록시 — 보안 강화판
// 보안·성능 계층 (요청 → 응답):
//   1. Rate limit  : IP 기반 분당 10 요청 (DoS·키 남용 방지)
//   2. Zod 검증     : .strict() 필드 화이트리스트 + 좌표 한국 영역 클램프
//   3. 캐시        : 좌표쌍 키 메모리 캐시 5분 TTL (동일 일정 반복 호출 시 카카오 API 절약)
//   4. NetworkOnly : Service Worker는 이 라우트 캐시 금지 (sw.ts)
//   5. REST 키     : 서버에서만 사용 (브라우저 미노출)
//
// 공식 문서: https://developers.kakaomobility.com/docs/navi-api/directions/

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

// 1. Zod 입력 스키마 — strict + 좌표 범위 검증 (한국 영역 + 약간의 여유)
const LegInputSchema = z
  .object({
    originLat: z.number().min(33).max(39),    // 한국 위도 33~38.6, 여유 +0.4
    originLng: z.number().min(124).max(132),  // 한국 경도 125~131, 여유 ±1
    destLat: z.number().min(33).max(39),
    destLng: z.number().min(124).max(132),
  })
  .strict();

const BodySchema = z
  .object({
    legs: z.array(LegInputSchema).min(1).max(30),
  })
  .strict();

type LegInput = z.infer<typeof LegInputSchema>;

interface LegResult {
  minutes: number;
  km: number;
}

interface LegError {
  error: string;
}

// 2. 메모리 Rate limit — IP 기반 60초 슬라이딩 윈도우
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX_PER_WINDOW = 10;
const rateBuckets = new Map<string, number[]>();

function checkRateLimit(ip: string): { ok: boolean; retryAfter?: number } {
  const now = Date.now();
  const windowStart = now - RATE_WINDOW_MS;
  const bucket = (rateBuckets.get(ip) ?? []).filter((t) => t > windowStart);
  if (bucket.length >= RATE_MAX_PER_WINDOW) {
    const retryAfter = Math.ceil((bucket[0] + RATE_WINDOW_MS - now) / 1000);
    rateBuckets.set(ip, bucket);
    return { ok: false, retryAfter };
  }
  bucket.push(now);
  rateBuckets.set(ip, bucket);
  // 메모리 누수 방지 — 윈도우 밖 항목은 다음 호출에서 자동 정리됨. 1000개 초과 IP는 oldest 제거.
  if (rateBuckets.size > 1000) {
    const firstKey = rateBuckets.keys().next().value;
    if (firstKey) rateBuckets.delete(firstKey);
  }
  return { ok: true };
}

// 3. 응답 메모리 캐시 — 좌표쌍 SHA-like 키 + 5분 TTL
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
interface CacheEntry {
  expiresAt: number;
  result: LegResult;
}
const cache = new Map<string, CacheEntry>();

function legKey(leg: LegInput): string {
  // 소수점 4자리(약 11m 정확도)로 반올림 — 동일 좌표 약간 다를 때도 캐시 히트
  const r = (n: number) => Math.round(n * 10000) / 10000;
  return `${r(leg.originLat)},${r(leg.originLng)}>${r(leg.destLat)},${r(leg.destLng)}`;
}

function cacheGet(key: string): LegResult | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.result;
}

function cacheSet(key: string, result: LegResult): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // LRU-like: 가장 오래된 항목 1건 제거
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, result });
}

// 4. 클라이언트 IP 추출 — 프록시 헤더 우선
// ⚠ 보안 전제: 신뢰할 수 있는 리버스 프록시(Vercel·nginx 등) 뒤 배포로 프록시가 x-forwarded-for를 재작성한다는 가정.
//    서버가 직접 노출되면 클라이언트가 XFF를 위조해 rate limit을 우회할 수 있다.
//    → 배포 인프라에서 XFF 재작성/신뢰 hop 설정 필수(코드만으로 방어 불가).
function getClientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real;
  return 'unknown';
}

// 5. POST 핸들러
export async function POST(req: NextRequest) {
  const key = process.env.KAKAO_REST_KEY;
  if (!key) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'KAKAO_REST_KEY 미설정. 카카오 디벨로퍼스 콘솔에서 모빌리티 활성화 + REST API 키를 발급받아 .env.local 에 추가 후 dev server 재시작 필요.',
      },
      { status: 503 },
    );
  }

  // Rate limit
  const ip = getClientIp(req);
  const rate = checkRateLimit(ip);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: `요청 한도 초과. ${rate.retryAfter}초 후 재시도하세요.` },
      {
        status: 429,
        headers: {
          'Retry-After': String(rate.retryAfter ?? 60),
          'X-RateLimit-Limit': String(RATE_MAX_PER_WINDOW),
          'X-RateLimit-Window': '60',
        },
      },
    );
  }

  // Body parse + Zod 검증
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: '입력 검증 실패',
        details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      { status: 422 },
    );
  }
  const { legs } = parsed.data;

  // 각 leg = 캐시 조회 → miss 시 카카오 API 호출. 병렬 처리.
  let cacheHits = 0;
  const results: (LegResult | LegError)[] = await Promise.all(
    legs.map(async (leg): Promise<LegResult | LegError> => {
      const k = legKey(leg);
      const cached = cacheGet(k);
      if (cached) {
        cacheHits++;
        return cached;
      }
      const url = new URL('https://apis-navi.kakaomobility.com/v1/directions');
      url.searchParams.set('origin', `${leg.originLng},${leg.originLat}`);
      url.searchParams.set('destination', `${leg.destLng},${leg.destLat}`);
      try {
        const res = await fetch(url.toString(), {
          headers: { Authorization: `KakaoAK ${key}` },
          cache: 'no-store',
        });
        if (!res.ok) {
          // 카카오 에러 본문에는 키 일부·내부 엔드포인트·요청 echo가 포함될 수 있어 클라이언트엔 상태코드만 노출.
          // 상세 본문은 서버 로그로만 남긴다(시크릿 노출 방지).
          const text = await res.text().catch(() => '');
          console.warn(`[route-time] Kakao API 오류 HTTP ${res.status}:`, text.slice(0, 200));
          return { error: `Kakao API 오류 (HTTP ${res.status})` };
        }
        const json = await res.json();
        const route = json?.routes?.[0];
        if (!route || route.result_code !== 0) {
          return {
            error: `result_code=${route?.result_code ?? '?'} ${route?.result_msg ?? ''}`.trim(),
          };
        }
        const summary = route.summary;
        const result: LegResult = {
          minutes: Math.round((summary?.duration ?? 0) / 60),
          km: Math.round(((summary?.distance ?? 0) / 1000) * 10) / 10,
        };
        cacheSet(k, result);
        return result;
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );

  const okCount = results.filter((r): r is LegResult => 'minutes' in r).length;
  return NextResponse.json(
    {
      ok: true,
      results,
      summary: {
        total: results.length,
        succeeded: okCount,
        failed: results.length - okCount,
        cacheHits,
        cacheMisses: results.length - cacheHits,
      },
    },
    {
      headers: {
        'X-RateLimit-Limit': String(RATE_MAX_PER_WINDOW),
        'X-RateLimit-Window': '60',
        'Cache-Control': 'private, no-store',
      },
    },
  );
}
