// The EAGER half of "Auto-update from source" (gap audit 5 lane J, item 10):
// only what the Library row menu needs synchronously -- the check mark and the
// disabled reason. The watcher itself (lib/sourceWatch.ts, its API client and
// store/reimportLive.ts) loads on the first toggle.

import type { Dataset } from "./types";

/** Worksheets being watched this session; lib/sourceWatch.ts keeps it in sync. */
export const watchedIds = new Set<string>();

export type CanAutoUpdate = { ok: true } | { ok: false; reason: string };

/** Can `ds` be watched? Only a worksheet with a real source path can. */
export function canAutoUpdate(ds: Dataset): CanAutoUpdate {
  if (ds.source?.path) return { ok: true };
  return {
    ok: false,
    reason: "No file path to watch: a browser upload never reveals one, and a derived worksheet has no file. Import the file by path (desktop app) to auto-update it.",
  };
}

/** Flip the toggle for worksheet `id` (loads the watcher on first use). */
export async function toggleAutoUpdate(id: string): Promise<CanAutoUpdate> {
  const { toggleAutoUpdate: toggle } = await import("./sourceWatch");
  return toggle(id);
}

/** Re-read a watched worksheet's file now -- e.g. one left on older data after an undo, whose
 *  measurement has finished (the watch otherwise waits for the file's next change). */
export async function readSourceNow(id: string): Promise<void> {
  const { readAutoUpdateNow } = await import("./sourceWatch");
  readAutoUpdateNow(id);
}
