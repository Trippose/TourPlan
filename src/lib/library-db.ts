// 보관함 서버 저장 — Neon Postgres(서버리스). 공용 단일 로그인이므로 모든 운영자가
// 같은 보관함을 공유한다(기기·브라우저·IP 무관). DB 환경변수가 없으면 isDbConfigured()=false →
// 호출부가 localStorage 폴백으로 동작한다(no-silent-fallback: 폴백 여부를 mode로 노출).
//
// 환경변수(Vercel Neon 통합이 자동 주입): DATABASE_URL(권장) 또는 POSTGRES_URL(레거시).
import { neon } from '@neondatabase/serverless';
import type { LibraryItem, LibrarySummary } from '@/lib/storage';

const DB_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';

export function isDbConfigured(): boolean {
  return DB_URL.length > 0;
}

function sql() {
  if (!DB_URL) throw new Error('library-db: DATABASE_URL/POSTGRES_URL 미설정');
  return neon(DB_URL);
}

// 테이블 1회 보장(idempotent — CREATE TABLE IF NOT EXISTS). 매 요청 첫 호출 시 안전.
let ensured = false;
async function ensureTable(): Promise<void> {
  if (ensured) return;
  const db = sql();
  await db`
    CREATE TABLE IF NOT EXISTS library_items (
      id        TEXT PRIMARY KEY,
      name      TEXT NOT NULL,
      author    TEXT,
      saved_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      summary   JSONB NOT NULL,
      data      JSONB NOT NULL,
      pin_hash  TEXT
    )
  `;
  ensured = true;
}

// DB row → 클라이언트 LibraryItem 형태로 매핑
interface Row {
  id: string;
  name: string;
  author: string | null;
  saved_at: string;
  summary: LibrarySummary;
  data: unknown;
  pin_hash: string | null;
}

function rowToItem(r: Row): LibraryItem {
  return {
    id: r.id,
    name: r.name,
    author: r.author ?? undefined,
    savedAt: typeof r.saved_at === 'string' ? r.saved_at : new Date(r.saved_at).toISOString(),
    summary: r.summary,
    data: r.data,
    pinHash: r.pin_hash ?? undefined,
  };
}

export async function dbListLibrary(): Promise<LibraryItem[]> {
  await ensureTable();
  const db = sql();
  const rows = (await db`
    SELECT id, name, author, saved_at, summary, data, pin_hash
    FROM library_items
    ORDER BY saved_at DESC
    LIMIT 200
  `) as unknown as Row[];
  return rows.map(rowToItem);
}

// UPSERT — 같은 id면 갱신, 없으면 삽입(멱등). 저장 후 최신 목록 반환.
export async function dbSaveLibrary(item: LibraryItem): Promise<LibraryItem[]> {
  await ensureTable();
  const db = sql();
  await db`
    INSERT INTO library_items (id, name, author, saved_at, summary, data, pin_hash)
    VALUES (
      ${item.id},
      ${item.name},
      ${item.author ?? null},
      ${item.savedAt},
      ${JSON.stringify(item.summary)}::jsonb,
      ${JSON.stringify(item.data)}::jsonb,
      ${item.pinHash ?? null}
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      author = EXCLUDED.author,
      saved_at = EXCLUDED.saved_at,
      summary = EXCLUDED.summary,
      data = EXCLUDED.data,
      pin_hash = EXCLUDED.pin_hash
  `;
  return dbListLibrary();
}

export async function dbDeleteLibrary(id: string): Promise<LibraryItem[]> {
  await ensureTable();
  const db = sql();
  await db`DELETE FROM library_items WHERE id = ${id}`;
  return dbListLibrary();
}

// 삭제·갱신 권한 검증용 — 해당 항목의 pin_hash 조회(없으면 null).
export async function dbGetPinHash(id: string): Promise<string | null | undefined> {
  await ensureTable();
  const db = sql();
  const rows = (await db`SELECT pin_hash FROM library_items WHERE id = ${id} LIMIT 1`) as unknown as { pin_hash: string | null }[];
  if (rows.length === 0) return undefined; // 존재하지 않음
  return rows[0].pin_hash;
}
