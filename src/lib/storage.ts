// 패키지 상태 localStorage 영속화 — 새로고침·세션 종료 시 사용자 입력 보존
// - 스키마 버전 관리 (마이그레이션 안전)
// - SSR 안전 (typeof window 가드)
// - JSON 파싱 오류 fail-closed (손상 데이터 시 null 반환)

export const STORAGE_KEY = "tour-pricing-pwa:state";
export const STORAGE_VERSION = 1;
// 슬롯별 키 — 견적 3개 슬롯 (0/1/2)
export const slotKey = (slot: number) => `${STORAGE_KEY}:slot-${slot}`;

export interface PersistedState<T = unknown> {
  version: number;
  savedAt: string; // ISO timestamp
  data: T;
}

export function loadState<T = unknown>(slot?: number): T | null {
  if (typeof window === "undefined") return null;
  try {
    const key = slot === undefined ? STORAGE_KEY : slotKey(slot);
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedState<T>;
    if (parsed.version !== STORAGE_VERSION) {
      // 스키마 마이그레이션 — 현재는 v1 한정. 향후 변환 함수 추가.
      console.warn(`[storage] version mismatch — expected ${STORAGE_VERSION}, got ${parsed.version}. Skipping load.`);
      return null;
    }
    return parsed.data ?? null;
  } catch (e) {
    console.warn("[storage] load failed:", e);
    return null;
  }
}

export function saveState<T>(data: T, slot?: number): boolean {
  if (typeof window === "undefined") return false;
  try {
    const key = slot === undefined ? STORAGE_KEY : slotKey(slot);
    const payload: PersistedState<T> = {
      version: STORAGE_VERSION,
      savedAt: new Date().toISOString(),
      data,
    };
    window.localStorage.setItem(key, JSON.stringify(payload));
    return true;
  } catch (e) {
    // 용량 초과 등
    console.warn("[storage] save failed:", e);
    return false;
  }
}

export function clearState(slot?: number): void {
  if (typeof window === "undefined") return;
  try {
    const key = slot === undefined ? STORAGE_KEY : slotKey(slot);
    window.localStorage.removeItem(key);
  } catch (e) {
    console.warn("[storage] clear failed:", e);
  }
}

// 디바운스 — 빈번한 입력에서 매번 저장하지 않게
export function debounce<F extends (...args: never[]) => unknown>(fn: F, wait: number): (...args: Parameters<F>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<F>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      fn(...args);
      timer = null;
    }, wait);
  };
}

// ──────────────── 명명 견적 보관함(Library) ────────────────
// 이름 붙여 다수 견적을 저장하고 목록에서 불러오기·삭제. (구 슬롯 3개를 대체)
export const LIBRARY_KEY = "tour-pricing-pwa:library";
export const LIBRARY_MAX = 50; // 보관 상한 (localStorage 용량 보호)

export interface LibrarySummary {
  packageName: string;
  partyTotal: number;
  stops: number;
  salePrice: number;
}

export interface LibraryItem {
  id: string;
  name: string;
  savedAt: string; // ISO timestamp
  summary: LibrarySummary;
  data: unknown; // 견적 payload 전체
}

// 저장된 data(payload)에서 목록 표시용 요약 추출 — page.tsx의 partyTotal 계산과 동일 규칙.
function summaryFromData(data: unknown): LibrarySummary {
  const d = (data ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const partyTiered = !!d.partyTiered;
  const partyTotal = partyTiered
    ? num(d.adult) + num(d.youth) + num(d.child) + num(d.infant)
    : num(d.totalPax);
  return {
    packageName: typeof d.packageName === "string" ? d.packageName : "",
    partyTotal,
    stops: Array.isArray(d.stops) ? d.stops.length : 0,
    salePrice: num(d.salePrice),
  };
}

export function loadLibrary(): LibraryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LIBRARY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PersistedState<LibraryItem[]>;
    if (parsed.version !== STORAGE_VERSION) return [];
    return Array.isArray(parsed.data) ? parsed.data : [];
  } catch (e) {
    console.warn("[storage] library load failed:", e);
    return [];
  }
}

function writeLibrary(items: LibraryItem[]): boolean {
  try {
    const payload: PersistedState<LibraryItem[]> = {
      version: STORAGE_VERSION,
      savedAt: new Date().toISOString(),
      data: items,
    };
    window.localStorage.setItem(LIBRARY_KEY, JSON.stringify(payload));
    return true;
  } catch (e) {
    console.warn("[storage] library write failed:", e);
    return false;
  }
}

// 신규 id 생성 — crypto.randomUUID 우선, 폴백은 시각+난수.
function newId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* 폴백 */
  }
  return `q-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

// 현재 견적을 이름 붙여 저장. 동일 id면 덮어쓰기, 신규면 맨 앞에 추가. 상한 초과 시 false.
export function saveToLibrary(name: string, data: unknown, id?: string): LibraryItem | null {
  if (typeof window === "undefined") return null;
  const items = loadLibrary();
  const item: LibraryItem = {
    id: id ?? newId(),
    name: name.trim() || "이름 없는 견적",
    savedAt: new Date().toISOString(),
    summary: summaryFromData(data),
    data,
  };
  const idx = items.findIndex((i) => i.id === item.id);
  if (idx >= 0) {
    items[idx] = item;
  } else {
    if (items.length >= LIBRARY_MAX) return null;
    items.unshift(item);
  }
  return writeLibrary(items) ? item : null;
}

export function deleteFromLibrary(id: string): void {
  if (typeof window === "undefined") return;
  writeLibrary(loadLibrary().filter((i) => i.id !== id));
}

// 구 슬롯(slot-0/1/2)에 남은 데이터를 보관함으로 1회 이전 후 슬롯 키 삭제. 이전 건수 반환.
export function migrateSlotsToLibrary(): number {
  if (typeof window === "undefined") return 0;
  const items = loadLibrary();
  let migrated = 0;
  for (let slot = 0; slot < 3; slot++) {
    const data = loadState(slot);
    if (!data) continue;
    const summary = summaryFromData(data);
    const name = summary.packageName.trim() || `슬롯 ${slot + 1} (이전)`;
    items.unshift({ id: newId(), name, savedAt: new Date().toISOString(), summary, data });
    clearState(slot);
    migrated++;
  }
  if (migrated > 0) writeLibrary(items);
  return migrated;
}
