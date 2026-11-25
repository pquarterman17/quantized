// Preference SLOTS: the one write path for every store-independent preference
// blob, and the hook that keeps a reader in step with it (PREFS_AUDIT lane 1).
//
// A slot is one `localStorage` key holding one JSON object (`qz.prefs`,
// `qz.fitPrefs`, ...). `localStorage` is the fast, synchronous cache; slots in
// the SYNCED set are also mirrored to the server prefs file (`/api/prefs`,
// owner decision 2026-11-25) by the lazy `lib/prefsServerSync.ts`, which
// listens through `onPrefSlotChange`. This module stays tiny and eager; the
// network half never loads until after boot.
//
// For a new pref slot (lanes 2 to 4), one call does everything:
//
//   export const exportPrefs = definePrefSlot("qz.exportPrefs", { format: "pdf" });
//   exportPrefs.load()          // parsed value, defaults for missing/invalid fields
//   exportPrefs.save({ ... })   // localStorage + server write-through + subscribers
//   exportPrefs.use()           // React hook, re-renders on any write (no stale copy)
//   exportPrefs.reset()         // back to defaults (Preferences ▸ Reset)
//
// Register the key in lib/storageKeys.ts (architecture ratchet). Content
// (templates, recipes, history) is NOT a pref slot: Reset and the server file
// are for settings only.

import { useSyncExternalStore } from "react";

const synced = new Set(["qz.prefs", "qz.fitPrefs", "qz.interactionPrefs", "qz.plotPerfPrefs", "qz.toolbarPrefs"]);
/** The slots mirrored to the server prefs file. */
export const syncedPrefSlots = (): string[] => [...synced];

const declared: PrefSlot<object>[] = [];
/** Every slot declared with `definePrefSlot` so far (Preferences ▸ Reset all). */
export const allPrefSlots = (): readonly PrefSlot<object>[] => declared;

const listeners = new Set<(key: string) => void>();
/** Called after every slot write with the slot's key; returns an unsubscribe. */
export function onPrefSlotChange(fn: (key: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** A slot's stored object, or null (absent, not an object, storage blocked). */
export function readPrefSlot(key: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Store `value` under `key` (null removes it), then notify. Storage that
 *  throws (private mode, quota) is non-fatal: the in-memory value applies. */
export function writePrefSlot(key: string, value: object | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: non-fatal */
  }
  for (const fn of listeners) fn(key);
}

/** Keep each field whose type matches its default's; else the default. */
export function parseByDefaults<T extends object>(defaults: T): (raw: Record<string, unknown>) => T {
  return (raw) => {
    const out = { ...defaults } as Record<string, unknown>;
    for (const [k, d] of Object.entries(defaults)) if (typeof raw[k] === typeof d) out[k] = raw[k];
    return out as T;
  };
}

export interface PrefSlot<T extends object> {
  readonly key: string;
  readonly defaults: T;
  load(): T;
  save(next: T): void;
  reset(): void;
  /** React hook: the current value, re-rendered on every write to the slot. */
  use(): T;
}

/** Declare a preference slot (see the header). `sync: false` keeps it
 *  browser-local (never sent to the server prefs file). */
export function definePrefSlot<T extends object>(
  key: string,
  defaults: T,
  parse: (raw: Record<string, unknown>) => T = parseByDefaults(defaults),
  opts: { sync?: boolean } = {},
): PrefSlot<T> {
  if (opts.sync !== false) synced.add(key);
  let lastRaw: string | null | undefined;
  let last = defaults;
  const load = (): T => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(key);
    } catch {
      /* blocked: defaults */
    }
    if (raw !== lastRaw) {
      lastRaw = raw;
      const obj = readPrefSlot(key);
      last = obj ? parse(obj) : defaults;
    }
    return last;
  };
  const subscribe = (fn: () => void) => onPrefSlotChange((k) => k === key && fn());
  const slot: PrefSlot<T> = {
    key,
    defaults,
    load,
    save: (next) => writePrefSlot(key, next),
    reset: () => writePrefSlot(key, null),
    use: () => useSyncExternalStore(subscribe, load),
  };
  declared.push(slot);
  return slot;
}
