// Calculator session memory (DiraCulator's addHistory + Home/History/Favorites
// tabs). A standalone Zustand store — like store/toasts — so any calculator tab
// can record a result via getState() without coupling to the main app store.
// Persisted to localStorage (qz.calcHistory) the same way recentFiles/prefs do,
// so a researcher's recent results + pinned favorites survive a reload.

import { create } from "zustand";

/** One recorded calculator result. `id` is a monotonic counter (deterministic in
 *  tests, unlike Date.now/Math.random); `ts` is an ISO timestamp for display. */
export interface CalcEntry {
  id: string;
  domain: string;
  label: string;
  summary: string;
  /** Exact raw input snapshot used for this result. Absent only on entries
   *  persisted by builds predating DIRACULATOR_AUDIT's provenance sweep. */
  inputs?: string;
  ts: string;
}

const KEY = "qz.calcHistory";
const HISTORY_MAX = 100;
const FAV_MAX = 50;

/** Per-entry cap on the `inputs` provenance snapshot.
 *
 *  Entry COUNTS have always been capped, but no string length was, and
 *  calculator card fields are free text -- a pasted column of numbers rides
 *  verbatim into localStorage and is then repeated across up to
 *  HISTORY_MAX + FAV_MAX retained entries. Measured: 120 records carrying a
 *  200 kB paste produced a 4.8 MB slot, against a ~5 MB browser budget shared
 *  with every other `qz.*` slot.
 *
 *  2 kB is far above any real card's input line (the longest in the app is a
 *  few dozen characters) and far below the point where 150 of them matter. */
export const INPUTS_MAX = 2048;

/** Bound a provenance snapshot, marking the cut so a truncated value is never
 *  mistaken for what the user actually typed. */
function clampInputs(v: string | undefined): string | undefined {
  if (v === undefined || v.length <= INPUTS_MAX) return v;
  return `${v.slice(0, INPUTS_MAX - 1)}\u2026`;
}

interface Persisted {
  history: CalcEntry[];
  favorites: CalcEntry[];
  seq: number;
}

const EMPTY: Persisted = { history: [], favorites: [], seq: 0 };

/** Keep only well-formed entries (defends against a malformed storage slot). */
function sane(x: unknown): CalcEntry[] {
  if (!Array.isArray(x)) return [];
  return x.filter(
    (e): e is CalcEntry =>
      !!e &&
      typeof e === "object" &&
      typeof (e as CalcEntry).id === "string" &&
      typeof (e as CalcEntry).summary === "string" &&
      ((e as CalcEntry).inputs === undefined || typeof (e as CalcEntry).inputs === "string"),
  )
    // Trim snapshots written by a build that predates the cap, so one legacy
    // slot cannot keep the store over quota forever.
    .map((e) => (e.inputs === undefined ? e : { ...e, inputs: clampInputs(e.inputs) }));
}

/** Read the persisted session (empty on absent / unreadable / malformed slot).
 *  Exported so the load-path clamp is testable through the real code path the
 *  store uses at creation, rather than through an action invented for a test. */
export function loadPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const p = JSON.parse(raw) as Partial<Persisted>;
    return {
      history: sane(p.history).slice(0, HISTORY_MAX),
      favorites: sane(p.favorites).slice(0, FAV_MAX),
      seq: typeof p.seq === "number" && Number.isFinite(p.seq) ? p.seq : 0,
    };
  } catch {
    return EMPTY;
  }
}

/** Persist the session (guarded against quota / private-mode failures).
 *
 *  The bare try/catch this replaces was correct about private mode but wrong
 *  about quota: once the slot no longer fit, EVERY subsequent write failed
 *  silently, so the user lost their whole history AND every pinned favorite on
 *  the next reload, with no signal. A quota failure should cost the oldest
 *  history, not the session. Retry with progressively fewer history entries
 *  (favorites are the user's deliberate picks and are shed last), and only
 *  give up when even a minimal slot will not fit -- which is the genuine
 *  storage-unavailable case the original catch was written for. */
function save(s: Persisted): void {
  const attempts: Persisted[] = [
    s,
    { ...s, history: s.history.slice(0, 25) },
    { ...s, history: s.history.slice(0, 5) },
    { ...s, history: [] },
  ];
  for (const attempt of attempts) {
    try {
      localStorage.setItem(KEY, JSON.stringify(attempt));
      return;
    } catch {
      /* try a smaller slot */
    }
  }
  /* storage unavailable — session memory is best-effort */
}

interface CalcHistoryState {
  history: CalcEntry[];
  favorites: CalcEntry[];
  // Monotonic id counter, persisted so ids stay unique across reloads.
  seq: number;
  /** Prepend a result to history (newest-first, capped). Side-effect only — safe
   *  to call from any tab's success path without a backend. */
  record: (entry: { domain: string; label: string; summary: string; inputs: string }) => void;
  /** Pin an entry into favorites (copied from history); unpin if already there. */
  toggleFavorite: (id: string) => void;
  isFavorite: (id: string) => boolean;
  clearHistory: () => void;
}

const _init = loadPersisted();

export const useCalcHistory = create<CalcHistoryState>((set, get) => ({
  history: _init.history,
  favorites: _init.favorites,
  seq: _init.seq,
  record: (entry) =>
    set((s) => {
      const seq = s.seq + 1;
      const e: CalcEntry = {
        id: `c${seq}`,
        ts: new Date().toISOString(),
        ...entry,
        inputs: clampInputs(entry.inputs),
      };
      const history = [e, ...s.history].slice(0, HISTORY_MAX);
      const next = { history, favorites: s.favorites, seq };
      save(next);
      return next;
    }),
  toggleFavorite: (id) =>
    set((s) => {
      let favorites: CalcEntry[];
      if (s.favorites.some((e) => e.id === id)) {
        favorites = s.favorites.filter((e) => e.id !== id); // unpin
      } else {
        const entry = s.history.find((e) => e.id === id);
        if (!entry) return s; // unknown id — no-op
        favorites = [entry, ...s.favorites].slice(0, FAV_MAX);
      }
      const next = { history: s.history, favorites, seq: s.seq };
      save(next);
      return next;
    }),
  isFavorite: (id) => get().favorites.some((e) => e.id === id),
  clearHistory: () =>
    set((s) => {
      const next = { history: [], favorites: s.favorites, seq: s.seq };
      save(next);
      return { history: [] };
    }),
}));
