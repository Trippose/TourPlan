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

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
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
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
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
