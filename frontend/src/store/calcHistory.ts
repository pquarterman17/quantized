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
  ts: string;
}

const KEY = "qz.calcHistory";
const HISTORY_MAX = 100;
const FAV_MAX = 50;

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
      typeof (e as CalcEntry).summary === "string",
  );
}

/** Read the persisted session (empty on absent / unreadable / malformed slot). */
function load(): Persisted {
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

/** Persist the session (guarded against quota / private-mode failures). */
function save(s: Persisted): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable — session memory is best-effort */
  }
}

interface CalcHistoryState {
  history: CalcEntry[];
  favorites: CalcEntry[];
  // Monotonic id counter, persisted so ids stay unique across reloads.
  seq: number;
  /** Prepend a result to history (newest-first, capped). Side-effect only — safe
   *  to call from any tab's success path without a backend. */
  record: (entry: { domain: string; label: string; summary: string }) => void;
  /** Pin an entry into favorites (copied from history); unpin if already there. */
  toggleFavorite: (id: string) => void;
  isFavorite: (id: string) => boolean;
  clearHistory: () => void;
}

const _init = load();

export const useCalcHistory = create<CalcHistoryState>((set, get) => ({
  history: _init.history,
  favorites: _init.favorites,
  seq: _init.seq,
  record: (entry) =>
    set((s) => {
      const seq = s.seq + 1;
      const e: CalcEntry = { id: `c${seq}`, ts: new Date().toISOString(), ...entry };
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
