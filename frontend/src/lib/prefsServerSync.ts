// Server half of the preference slots (owner decision 2026-11-25, PREFS_AUDIT
// P0-1). LAZY: main.tsx imports it after boot, so none of this is eager.
//
// The store boots synchronously from localStorage (the fast cache). Then:
//
// 1. Hydrate. GET /api/prefs. For every synced slot the server holds, the
//    SERVER wins: it is written into localStorage and re-applied (qz.prefs
//    back into the store + <html>; side slots notify their `use()` readers).
//    A slot the user changed while the request was in flight is NOT
//    overwritten: that newer local value is pushed instead.
// 2. Migrate. When the server file holds none of the synced slots but this
//    browser does, upload them, so nobody loses settings when this ships (or
//    on the first launch of a new install whose browser already has prefs).
// 3. Offline. A failed GET (no backend, the test runner, a network error)
//    leaves localStorage as the source; nothing is sent.
// 4. Write-through. Every later slot write is PUT, debounced, merged by the
//    server so two tabs writing different slots never clobber each other;
//    `pagehide` flushes the pending batch with `keepalive`.

import { loadPrefs, syncPrefs } from "../store/prefs";
import { useApp } from "../store/useApp";
import { onPrefSlotChange, readPrefSlot, syncedPrefSlots, writePrefSlot } from "./prefSlots";

export const PREFS_ENDPOINT = "/api/prefs";
export const PREFS_PUT_DEBOUNCE_MS = 600;

export type HydrateOutcome = "server" | "migrated" | "empty" | "offline";

interface SyncState {
  hydrated: boolean;
  online: boolean;
  applying: boolean;
  pending: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
  stop: () => void;
}

let state: SyncState | null = null;

function bodyFor(keys: Iterable<string>): string {
  const slots: Record<string, object | null> = {};
  for (const k of keys) slots[k] = readPrefSlot(k);
  return JSON.stringify({ slots });
}

async function put(keys: string[], keepalive = false): Promise<boolean> {
  if (keys.length === 0) return true;
  try {
    const res = await fetch(PREFS_ENDPOINT, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: bodyFor(keys),
      keepalive,
    });
    return res.ok;
  } catch {
    return false;
  }
}

function flush(keepalive = false): Promise<boolean> {
  const s = state;
  if (!s) return Promise.resolve(true);
  if (s.timer !== null) clearTimeout(s.timer);
  s.timer = null;
  const keys = [...s.pending];
  s.pending.clear();
  return s.online ? put(keys, keepalive) : Promise.resolve(true);
}

/** Push any pending slot writes now (tests; `pagehide`). */
export const flushPrefsNow = (): Promise<boolean> => flush();

/** Apply one server slot locally without echoing it back to the server. */
function applyServerSlot(key: string, value: object): void {
  const s = state!;
  s.applying = true;
  try {
    writePrefSlot(key, value);
    if (key === "qz.prefs") {
      // layoutMode goes through its own writer (turning windows on seeds a
      // layout); every other field is plain state.
      const { layoutMode, ...rest } = loadPrefs();
      const before = useApp.getState().layoutMode;
      useApp.setState(rest);
      syncPrefs(useApp.getState());
      if (layoutMode !== before) void useApp.getState().setLayoutMode(layoutMode);
    }
  } finally {
    s.applying = false;
  }
}

function rawOf(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Start the sync once per page. Resolves with how the prefs were sourced. */
export async function startPrefsServerSync(): Promise<HydrateOutcome> {
  if (state) state.stop();
  const s: SyncState = {
    hydrated: false,
    online: false,
    applying: false,
    pending: new Set(),
    timer: null,
    stop: () => {},
  };
  state = s;
  const synced = new Set(syncedPrefSlots());
  // A write before the GET answers is the user's newer choice only if it
  // CHANGED the slot: boot code re-writes `qz.prefs` with the same content
  // (syncPrefs on every apply), and that must not beat the server.
  const dirty = new Set<string>();
  const atStart = new Map([...synced].map((k) => [k, rawOf(k)]));
  const unsub = onPrefSlotChange((key) => {
    if (s.applying || !synced.has(key)) return;
    if (!s.hydrated) {
      if (rawOf(key) !== atStart.get(key)) dirty.add(key);
      return;
    }
    s.pending.add(key);
    if (s.timer !== null) clearTimeout(s.timer);
    s.timer = setTimeout(() => void flush(), PREFS_PUT_DEBOUNCE_MS);
  });
  const onHide = () => void flush(true);
  window.addEventListener("pagehide", onHide);
  s.stop = () => {
    unsub();
    window.removeEventListener("pagehide", onHide);
    if (s.timer !== null) clearTimeout(s.timer);
    if (state === s) state = null;
  };

  let server: Record<string, unknown>;
  let notice: string | null = null;
  try {
    const res = await fetch(PREFS_ENDPOINT);
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as { slots?: unknown; notice?: unknown };
    if (!body.slots || typeof body.slots !== "object") throw new Error("bad shape");
    server = body.slots as Record<string, unknown>;
    if (typeof body.notice === "string") notice = body.notice;
  } catch {
    s.hydrated = true; // offline: localStorage stays the source; writes stay local
    return "offline";
  }
  if (state !== s) return "offline"; // superseded by a newer start
  s.online = true;
  if (notice) useApp.getState().setStatus(notice, "warn");

  const held = [...synced].filter((k) => server[k] && typeof server[k] === "object");
  let outcome: HydrateOutcome;
  if (held.length > 0) {
    for (const k of held) if (!dirty.has(k)) applyServerSlot(k, server[k] as object);
    // Slots the server lacks (a slot added since) and ones edited mid-request.
    const push = [...synced].filter((k) => (!held.includes(k) || dirty.has(k)) && readPrefSlot(k));
    s.hydrated = true;
    await put(push);
    outcome = "server";
  } else {
    const local = [...synced].filter((k) => readPrefSlot(k));
    s.hydrated = true;
    if (local.length === 0) return "empty";
    await put(local);
    outcome = "migrated";
  }
  return outcome;
}

/** Tests: stop listening and forget the page's sync. */
export function stopPrefsServerSync(): void {
  state?.stop();
}
