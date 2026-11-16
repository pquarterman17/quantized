// The unattended re-import behind "Auto-update from source" (gap audit 5 lane
// J, item 10): `lib/sourceWatch.ts` calls this each time the watched file has
// changed and settled. It is the existing re-import path
// (store/reimport.ts's `computeReimportMerge` + `applyReimportMerge`, so the
// same corrections, formula recompute, linked-graph follow and fit-stale
// marking as a manual "Re-import from source"), run without what only a person
// at the keyboard wants: no "downstream impact" confirm, no Relink panel, no
// recorded macro line. The read itself is `/api/parsers/import`'s live mode
// (lib/api/sourceWatch.ts `importLive`): a consistent snapshot with an
// unfinished last line held back, refused (409) when the file moved under it.
//
// A file that only GAINED rows under the same columns is not a reshape
// (`computeReimportMerge`'s `grow`, compared against `base` = the rows the
// watcher last installed, so a hand-edited cell does not count as a reshape):
// plot styles, hidden series, axis choices and excluded rows survive a growing
// measurement.
//
// UNDO AND REDO -- the rules, and why:
//  1. A live update NEVER clears redo. `recordHistory` empties `future` (any new
//     edit invalidates what was undone); a background re-read is not the user's
//     edit, so a labelled step is pushed with `future` put back (`pushStep`).
//  2. A plain growing update is QUIET: no undo step (a measurement can refresh
//     every few seconds and would push the user's own edits off the stack).
//     Instead every history AND redo snapshot whose copy of this worksheet holds
//     the generation being replaced (identity, like `liveNavigation` in
//     restorePatch) is REBASED onto the fresh rows (and source baseline), so
//     undoing or redoing an unrelated edit never brings stale rows back.
//  3. An update that replaces something the user made -- the worksheet differs
//     from what was installed (a hand edit, an undo or a redo: `diverged`), the
//     file's shape changed, or this is the first read since the toggle went on
//     and its rows differ from the file's (a first read that finds the worksheet
//     already equal to the file just adopts it, quietly) -- is ONE labelled
//     undo step, with a toast. It still does not clear redo (rule 1). Chosen
//     over "pause while redo is available" because redo can stay non-empty for
//     an entire session, and a paused watch is exactly what a running
//     measurement must not silently become; every replaced state stays one
//     Ctrl+Z away and nothing in `future` is lost.
//  4. A reshape does not rebase older snapshots (their excluded rows and views
//     describe the old shape); undoing to one shows the old rows, which the
//     watcher then treats as diverged (rule 3) until the file next changes.
//
// Lazy (reached only through the watcher).

import { importLive, type LiveRead } from "../lib/api/sourceWatch";
import { HttpError } from "../lib/api/http";
import type { DataStruct, Dataset } from "../lib/types";
import type { HistoryEntry } from "./history";
import { toast } from "./toasts";
import { reimportIsAppend, resolveFreshData } from "../lib/reimport";
import { applyReimportMerge, computeReimportMerge } from "./reimport";
import type { AppState } from "./useApp";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

/** One watcher round's file reads, by path + hold: worksheets of one file read it once. */
export type ImportCache = Map<string, Promise<LiveRead>>;

export interface LiveOpts {
  /** Leave an unfinished last line out of the read. */
  hold: boolean;
  /** The `data` this watcher last installed in the worksheet (null: none yet this session). */
  installed: DataStruct | null;
  /** The file rows of that generation (the append test's base); null: the worksheet's own. */
  base: DataStruct | null;
}

export type LiveReimport =
  | { ok: true; rows: number; reshaped: boolean; labelled: boolean; stamp: string; held: boolean; data: DataStruct }
  /** `stale`: the worksheet changed while the file was read, or the file did
   *  (409): nothing was written; the next poll retries. */
  | { ok: false; stale: boolean; error: string };

/** Push a labelled undo step for the CURRENT state without clearing redo (rule 1). */
function pushStep(set: SliceSet, get: SliceGet, label: string): number | undefined {
  const future = get().future;
  get().recordHistory(label);
  set({ future });
  return get().history[get().history.length - 1]?.seq;
}

/** Re-read `id`'s source file and install it in place. Never throws; on any
 *  failure the dataset is left exactly as it was. */
export async function liveReimport(set: SliceSet, get: SliceGet, id: string, shared: ImportCache, opts: LiveOpts): Promise<LiveReimport> {
  const ds = get().datasets.find((d) => d.id === id);
  if (!ds?.source) return { ok: false, stale: false, error: "the worksheet no longer has a source file" };
  try {
    const key = `${opts.hold ? 1 : 0}\0${ds.source.path}`;
    const pending = shared.get(key) ?? importLive(ds.source.path, opts.hold);
    shared.set(key, pending);
    const read = await pending;
    const freshRaw = await resolveFreshData(ds, read.data);
    const merge = await computeReimportMerge(get, ds, freshRaw, { base: opts.base ?? undefined });
    // Anything awaited above may have let the user (or a project switch) change this worksheet;
    // a store update replaces the dataset object, so identity is the whole-worksheet check.
    if (get().datasets.find((d) => d.id === id) !== ds) return { ok: false, stale: true, error: "the worksheet changed while its file was being read" };
    const diverged = opts.installed !== null && ds.data !== opts.installed;
    const own = ds.corrections && ds.raw ? ds.raw : ds.data;
    if (opts.installed === null && !merge.shapeChanged && freshRaw.time.length === own.time.length && reimportIsAppend(ds, freshRaw)) {
      // First read, and the worksheet already holds exactly the file's rows: adopt them as the
      // installed generation (no step, nothing rewritten but the source baseline).
      stampSource(set, id, ds, read);
      return { ok: true, rows: own.time.length, reshaped: false, labelled: false, stamp: read.stamp, held: read.held, data: ds.data };
    }
    const label = diverged
      ? "Auto-update replaced your edits"
      : merge.shapeChanged
        ? "Auto-update (the file's shape changed)"
        : opts.installed === null
          ? "Auto-update (first read of the file)"
          : null;
    const stepSeq = label ? pushStep(set, get, label) : undefined;
    applyReimportMerge(set, get, ds, merge, undefined, true);
    stampSource(set, id, ds, read);
    const next = get().datasets.find((d) => d.id === id);
    const old = opts.installed ?? (label ? null : ds.data);
    if (next && old && !merge.shapeChanged) rebaseHistory(set, id, old, next, stepSeq);
    if (label) toast(diverged ? `Auto-update replaced your edits to "${ds.name}" with the file's newer data. Undo (Ctrl+Z) brings them back.` : `"${ds.name}" was updated from its file (undoable).`, "info");
    return { ok: true, rows: merge.newData.time.length, reshaped: merge.shapeChanged, labelled: label !== null, stamp: read.stamp, held: read.held, data: next?.data ?? merge.newData };
  } catch (e) {
    if (e instanceof HttpError && e.status === 409) return { ok: false, stale: true, error: e.message };
    return { ok: false, stale: false, error: e instanceof Error ? e.message : "error" };
  }
}

/** The read's baseline becomes the worksheet's source record: the probe's own mtime float,
 *  size and checksum (relink/pack compare these). `source` only: no cell of `data` is written. */
function stampSource(set: SliceSet, id: string, ds: Dataset, read: LiveRead): void {
  const source = { ...ds.source!, mtime: read.mtime, size: read.size, checksum: read.checksum || undefined };
  const stamped = (list: Dataset[]): Dataset[] => list.map((d) => (d.id === id ? { ...d, source } : d));
  set((s) => ({ datasets: stamped(s.datasets) }));
}

/** Point every undo/redo snapshot's copy of worksheet `id` that still holds `old` at `next`'s
 *  rows and source baseline -- except the step this very update pushed (`skipSeq`). */
function rebaseHistory(set: SliceSet, id: string, old: DataStruct, next: Dataset, skipSeq: number | undefined): void {
  const fix = (list: HistoryEntry[]): HistoryEntry[] =>
    list.map((e) => {
      const held = e.seq === skipSeq ? undefined : e.snapshot.datasets.find((d) => d.id === id);
      if (!held || held.data !== old) return e;
      const datasets = e.snapshot.datasets.map((d) => (d.id === id ? { ...d, data: next.data, source: next.source, ...(d.raw ? { raw: next.raw } : {}) } : d));
      return { ...e, snapshot: { ...e.snapshot, datasets } };
    });
  set((s) => ({ history: fix(s.history), future: fix(s.future) }));
}
