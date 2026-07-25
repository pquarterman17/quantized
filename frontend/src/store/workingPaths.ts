// Working paths (MAIN_PLAN #31): the folders a user actually keeps data in.
//
// The pain point the plan names is repeat work down "long network-drive paths".
// A native dialog fixes picking a file ONCE; what makes the second and tenth
// time fast is the dialog opening where the data already is. So this is a small
// persisted list of directories: the most recently used ones float to the top,
// pinned ones stay regardless, and a chosen path becomes the starting directory
// for the next native pick.
//
// A standalone store (like ./toasts, ./autosaveStatus) rather than a field on
// useApp: it is cross-project preference-shaped state, never serialized into a
// `.dwk`, and useApp sits at its size ratchet.
//
// NOTE ON TRUST: a working path grants NO read access. Consent in
// quantized/desktop_consent.py is per FILE and only ever granted by a real
// dialog, so this list is a convenience for where to START looking — nothing
// here can widen what the backend will read.

import { create } from "zustand";

export const WORKING_PATHS_KEY = "qz.workingPaths";
/** Unpinned entries beyond this are dropped, oldest-used first. Pinned entries
 *  never count against it — pinning is the user saying "keep this". */
export const MAX_UNPINNED = 8;

export interface WorkingPath {
  /** Absolute directory path — the identity of the entry. */
  path: string;
  /** Display name. Defaults to the last path segment; user-renameable, because
   *  three shares all ending in "data" are indistinguishable otherwise. */
  label: string;
  /** Pinned entries survive eviction and sort first. */
  pinned: boolean;
  /** Epoch ms of last use, for recency ordering. */
  usedAt: number;
}

/** Last segment of a path, for the default label. */
export function defaultLabel(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** Pinned first, then most-recently-used. Pure. */
export function orderPaths(paths: readonly WorkingPath[]): WorkingPath[] {
  return [...paths].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.usedAt - a.usedAt,
  );
}

/** Apply the unpinned cap, keeping every pinned entry. Pure. */
export function evictPaths(
  paths: readonly WorkingPath[],
  maxUnpinned = MAX_UNPINNED,
): WorkingPath[] {
  const ordered = orderPaths(paths);
  const pinned = ordered.filter((p) => p.pinned);
  const unpinned = ordered.filter((p) => !p.pinned).slice(0, Math.max(0, maxUnpinned));
  return orderPaths([...pinned, ...unpinned]);
}

/** Record a use of `path`, adding it when new. Pure: `now` is injected so
 *  ordering is reproducible in tests. Re-using an existing path keeps its label
 *  and pin — re-visiting a folder must not silently discard a rename. */
export function touchPath(
  paths: readonly WorkingPath[],
  path: string,
  now: number,
): WorkingPath[] {
  const existing = paths.find((p) => p.path === path);
  const next: WorkingPath = existing
    ? { ...existing, usedAt: now }
    : { path, label: defaultLabel(path), pinned: false, usedAt: now };
  return evictPaths([next, ...paths.filter((p) => p.path !== path)]);
}

interface WorkingPathsState {
  paths: WorkingPath[];
  /** The directory the next native pick should open in ("" = let the OS pick). */
  current: string;
  use: (path: string, now?: number) => void;
  setPinned: (path: string, pinned: boolean) => void;
  rename: (path: string, label: string) => void;
  remove: (path: string) => void;
}

function load(): { paths: WorkingPath[]; current: string } {
  try {
    const raw = localStorage.getItem(WORKING_PATHS_KEY);
    if (!raw) return { paths: [], current: "" };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { paths: [], current: "" };
    const { paths, current } = parsed as { paths?: unknown; current?: unknown };
    const list = Array.isArray(paths)
      ? paths.filter(
          (p): p is WorkingPath =>
            !!p && typeof p === "object" && typeof (p as WorkingPath).path === "string",
        )
      : [];
    return { paths: orderPaths(list), current: typeof current === "string" ? current : "" };
  } catch {
    return { paths: [], current: "" }; // corrupt slot must never block startup
  }
}

function persist(state: { paths: WorkingPath[]; current: string }): void {
  try {
    localStorage.setItem(
      WORKING_PATHS_KEY,
      JSON.stringify({ paths: state.paths, current: state.current }),
    );
  } catch {
    /* quota / private mode — working paths are best-effort convenience */
  }
}

const initial = load();

export const useWorkingPaths = create<WorkingPathsState>((set, get) => ({
  paths: initial.paths,
  current: initial.current,

  use: (path, now = Date.now()) => {
    if (!path) return;
    const paths = touchPath(get().paths, path, now);
    set({ paths, current: path });
    persist({ paths, current: path });
  },

  setPinned: (path, pinned) => {
    const paths = evictPaths(
      get().paths.map((p) => (p.path === path ? { ...p, pinned } : p)),
    );
    set({ paths });
    persist({ paths, current: get().current });
  },

  rename: (path, label) => {
    const trimmed = label.trim();
    // An empty rename falls back to the segment name rather than leaving a
    // blank, unclickable row.
    const paths = get().paths.map((p) =>
      p.path === path ? { ...p, label: trimmed || defaultLabel(path) } : p,
    );
    set({ paths });
    persist({ paths, current: get().current });
  },

  remove: (path) => {
    const paths = get().paths.filter((p) => p.path !== path);
    // Removing the CURRENT working path clears it, so the next dialog opens
    // wherever the OS defaults rather than at a folder the user just discarded.
    const current = get().current === path ? "" : get().current;
    set({ paths, current });
    persist({ paths, current });
  },
}));
