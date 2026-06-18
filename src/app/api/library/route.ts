// 보관함 서버 API — 공용 보관함(모든 로그인 운영자 공유)을 Neon Postgres에 저장.
// GET 목록 / POST 저장(UPSERT) / DELETE 삭제. 인증(AUTH 쿠키) 필수.
//
// 폴백 계약(no-silent-fallback): DB 미설정·오류 시 200 + { ok:false, mode:'localStorage' }로
// 응답해 클라이언트가 기존 localStorage 경로로 안전하게 동작하게 한다(조용한 실패 없음).
// PIN(삭제 보호)은 클라이언트 verifyLibraryPin로 검증한다(기존 동작 유지) — 서버는 저장소+인증 게이트.
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AUTH_COOKIE, readAuthConfig, verifyAuthToken } from '@/lib/auth';
import { isDbConfigured, dbListLibrary, dbSaveLibrary, dbDeleteLibrary } from '@/lib/library-db';
import type { LibraryItem } from '@/lib/storage';

export const runtime = 'nodejs';

async function isAuthed(req: NextRequest): Promise<boolean> {
  const cfg = readAuthConfig();
  if (!cfg) return false;
  const token = req.cookies.get(AUTH_COOKIE)?.value;
  return verifyAuthToken(cfg.secret, token);
}

// 폴백 응답 — DB 미설정/오류 시 클라이언트가 localStorage로 동작하도록 신호
const fallback = (reason: string) =>
  NextResponse.json({ ok: false, mode: 'localStorage', reason }, { status: 200 });

const SummarySchema = z.object({
  packageName: z.string(),
  partyTotal: z.number(),
  stops: z.number(),
  salePrice: z.number(),
});

const ItemSchema = z
  .object({
    id: z.string().min(1).max(80),
    name: z.string().min(1).max(120),
    author: z.string().max(40).optional(),
    savedAt: z.string().min(1).max(40),
    summary: SummarySchema,
    data: z.unknown(),
    pinHash: z.string().max(128).optional(),
  })
  .strict();

export async function GET(req: NextRequest) {
  if (!isDbConfigured()) return fallback('db-not-configured');
  if (!(await isAuthed(req))) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  try {
    const items = await dbListLibrary();
    return NextResponse.json({ ok: true, mode: 'server', items });
  } catch (e) {
    console.warn('[api/library] GET failed:', e);
    return fallback('db-error');
  }
}

export async function POST(req: NextRequest) {
  if (!isDbConfigured()) return fallback('db-not-configured');
  if (!(await isAuthed(req))) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  let item: LibraryItem;
  try {
    const raw = await req.json();
    const parsed = ItemSchema.safeParse(raw?.item);
    if (!parsed.success) return NextResponse.json({ ok: false, error: 'invalid-item' }, { status: 400 });
    item = parsed.data as LibraryItem;
  } catch {
    return NextResponse.json({ ok: false, error: 'bad-json' }, { status: 400 });
  }
  try {
    const items = await dbSaveLibrary(item);
    return NextResponse.json({ ok: true, mode: 'server', items });
  } catch (e) {
    console.warn('[api/library] POST failed:', e);
    return fallback('db-error');
  }
}

export async function DELETE(req: NextRequest) {
  if (!isDbConfigured()) return fallback('db-not-configured');
  if (!(await isAuthed(req))) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ ok: false, error: 'missing-id' }, { status: 400 });
  try {
    const items = await dbDeleteLibrary(id);
    return NextResponse.json({ ok: true, mode: 'server', items });
  } catch (e) {
    console.warn('[api/library] DELETE failed:', e);
    return fallback('db-error');
  }
}
