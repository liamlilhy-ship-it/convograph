/**
 * IndexedDB-backed settings store. Runs ONLY in extension-origin contexts (the
 * background service worker) — IndexedDB there is private to the extension and
 * needs no manifest permission. Content scripts must go through the message
 * client instead (their IndexedDB would belong to the page's origin).
 */
import { DEFAULTS, type Settings } from './settings';

const DB_NAME = 'cg-settings';
const STORE = 'kv';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function requestAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function readSettings(): Promise<Settings> {
  try {
    const db = await openDb();
    try {
      const store = db.transaction(STORE, 'readonly').objectStore(STORE);
      const out: Settings = { ...DEFAULTS };
      for (const key of Object.keys(DEFAULTS) as Array<keyof Settings>) {
        const v = await requestAsPromise(store.get(key));
        if (v !== undefined) out[key] = v as Settings[typeof key];
      }
      return out;
    } finally {
      db.close();
    }
  } catch {
    return { ...DEFAULTS };
  }
}

export async function writeSetting<K extends keyof Settings>(
  key: K,
  value: Settings[K],
): Promise<void> {
  try {
    const db = await openDb();
    try {
      await requestAsPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key));
    } finally {
      db.close();
    }
  } catch {
    // Persistence is best-effort — the in-session broadcast still applies.
  }
}
