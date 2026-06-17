// 챗봇 대화 IndexedDB 영속 — localStorage 50건 제한 박멸, 무제한 대화 보존
// 단순한 IndexedDB 래퍼 — 외부 의존 0 (idb 패키지 미사용)

export interface StoredMessage {
  id?: number;
  ts: number;
  role: 'user' | 'assistant';
  content: string;
  mode?: string;
  provider?: string;
}

const DB_NAME = 'tour-pricing-chat';
const DB_VERSION = 1;
const STORE = 'messages';

// 모듈 수준 싱글턴 — 호출마다 새 IDBDatabase를 열지 않도록 1회만 열고 재사용
let _dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      _dbPromise = null;
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('ts', 'ts', { unique: false });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // 예기치 않은 버전 변경·강제 close 시 캐시 무효화
      db.onclose = () => { _dbPromise = null; };
      db.onversionchange = () => { db.close(); _dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => {
      _dbPromise = null;
      reject(req.error);
    };
  });
  return _dbPromise;
}

export async function chatDbSave(msg: StoredMessage): Promise<number | null> {
  try {
    const db = await openDb();
    return await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const req = store.add(msg);
      req.onsuccess = () => resolve(req.result as number);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[chat-db] save failed:', err);
    return null;
  }
}

export async function chatDbLoadAll(): Promise<StoredMessage[]> {
  try {
    const db = await openDb();
    return await new Promise<StoredMessage[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const idx = store.index('ts');
      const req = idx.getAll();
      req.onsuccess = () => resolve((req.result || []) as StoredMessage[]);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[chat-db] loadAll failed:', err);
    return [];
  }
}

export async function chatDbClear(): Promise<boolean> {
  try {
    const db = await openDb();
    return await new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const req = store.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[chat-db] clear failed:', err);
    return false;
  }
}

export async function chatDbCount(): Promise<number> {
  try {
    const db = await openDb();
    return await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const req = store.count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return 0;
  }
}
