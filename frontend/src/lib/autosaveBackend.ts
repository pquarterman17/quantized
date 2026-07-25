// Autosave storage adapters (MAIN_PLAN #32) — the IMPURE half.
//
// Kept deliberately thin. jsdom implements no IndexedDB, so anything written
// here is effectively untestable in the unit suite; every rule that can be
// wrong therefore lives in ./autosaveGenerations.ts instead, and this file only
// moves bytes. Same discipline the repo already applies to Origin COM (OS-gated,
// mock-tested) and canvas rendering (needs the visual harness).
//
// Why IndexedDB at all: localStorage is a synchronous ~5 MB key/value store,
// and a scientific workspace with several imported instrument files clears that
// easily. IndexedDB is asynchronous, orders of magnitude larger, and can hold
// several generations. localStorage stays as the fallback for private mode and
// any engine where IDB is unavailable, where it degrades to ONE generation —
// which is exactly the old behaviour, so the fallback is never a regression.

import type { Generation } from "./autosaveGenerations";

/** What the autosave layer needs from a store. Implemented three ways below. */
export interface AutosaveBackend {
  /** Every retained generation. Order is not guaranteed — callers sort. */
  read(): Promise<Generation[]>;
  /** Replace the retained set wholesale. Rejects if the store refuses. */
  write(generations: readonly Generation[]): Promise<void>;
  clear(): Promise<void>;
  /** For diagnostics + the health readout. */
  readonly kind: "indexeddb" | "localstorage" | "memory";
}

const DB_NAME = "qz.autosave";
const DB_VERSION = 1;
const STORE = "generations";
/** Legacy single-slot key. Read once for migration, then left alone. */
export const LEGACY_KEY = "qz.autosave";

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        // Keyed by timestamp: generations are inherently time-ordered and a
        // collision would mean two saves in the same millisecond, which
        // overwriting is the correct response to anyway.
        db.createObjectStore(STORE, { keyPath: "at" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

export function indexedDbBackend(): AutosaveBackend {
  return {
    kind: "indexeddb",
    async read() {
      const db = await openDb();
      try {
        const tx = db.transaction(STORE, "readonly");
        return await idbRequest(tx.objectStore(STORE).getAll() as IDBRequest<Generation[]>);
      } finally {
        db.close();
      }
    },
    async write(generations) {
      const db = await openDb();
      try {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        // Clear-then-put inside ONE transaction: a crash mid-write leaves the
        // previous generations intact rather than a half-replaced set.
        await idbRequest(store.clear());
        for (const gen of generations) await idbRequest(store.put(gen));
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onabort = tx.onerror = () =>
            reject(tx.error ?? new Error("IndexedDB write failed"));
        });
      } finally {
        db.close();
      }
    },
    async clear() {
      const db = await openDb();
      try {
        const tx = db.transaction(STORE, "readwrite");
        await idbRequest(tx.objectStore(STORE).clear());
      } finally {
        db.close();
      }
    },
  };
}

/** Fallback: one generation in localStorage — the pre-#32 behaviour, so a
 *  browser without IndexedDB is no worse off than before. */
export function localStorageBackend(key = LEGACY_KEY): AutosaveBackend {
  return {
    kind: "localstorage",
    async read() {
      const text = localStorage.getItem(key);
      if (!text) return [];
      // The legacy slot held bare `.dwk` text with no timestamp. `at: 0` sorts
      // it oldest, which is right: any real generation should win.
      try {
        const parsed: unknown = JSON.parse(text);
        if (parsed && typeof parsed === "object" && "at" in parsed && "text" in parsed) {
          return [parsed as Generation];
        }
      } catch {
        /* not a wrapped generation — treat as legacy bare text below */
      }
      return [{ at: 0, text }];
    },
    async write(generations) {
      const newest = [...generations].sort((a, b) => b.at - a.at)[0];
      if (!newest) {
        localStorage.removeItem(key);
        return;
      }
      localStorage.setItem(key, JSON.stringify(newest));
    },
    async clear() {
      localStorage.removeItem(key);
    },
  };
}

/** In-memory backend — used by tests, and as the last resort when neither
 *  browser store is usable (autosave then does nothing, but nothing throws). */
export function memoryBackend(seed: Generation[] = []): AutosaveBackend {
  let held = [...seed];
  return {
    kind: "memory",
    async read() {
      return [...held];
    },
    async write(generations) {
      held = [...generations];
    },
    async clear() {
      held = [];
    },
  };
}

/** Pick the best available store. IndexedDB when the engine has it, else
 *  localStorage, else memory. Never throws — autosave must not break startup. */
export function defaultBackend(): AutosaveBackend {
  try {
    if (typeof indexedDB !== "undefined" && indexedDB !== null) return indexedDbBackend();
  } catch {
    /* accessing indexedDB can itself throw in a locked-down context */
  }
  try {
    if (typeof localStorage !== "undefined") return localStorageBackend();
  } catch {
    /* private mode / storage disabled */
  }
  return memoryBackend();
}
