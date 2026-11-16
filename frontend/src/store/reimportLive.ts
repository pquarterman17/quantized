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
// watcher last installed, so a hand-edited cell does not count as a reshape;
// their LAST row may differ -- a read after a long pause can take a writer's
// half-flushed line, and its completion changes no row index):
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
import { holdsFileRows, untouchedPrefix, reimportBaseCols, reimportColumnsChanged, resolveFreshData, rowsArePrefix } from "../lib/reimport";
import { applyReimportMerge, computeReimportMerge } from "./reimport";
import type { AppState } from "./useApp";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

/** One watcher round's file reads, by path + hold: worksheets of one file read it once. */
export type ImportCache = Map<string, Promise<LiveRead>>;

export interface LiveOpts {
  /** Leave an unfinished last line out of the read. */
  hold: boolean;
  /** The file rows this watcher last installed (`raw` with corrections); null: none yet this
   *  session. Divergence and the history rebase are decided on these, never on `data`'s
   *  identity: fit()/sheet() column refreshes and background recalcs rewrite `data` too. */
  base: DataStruct | null;
  /** Still wanted when the read lands? (false: the toggle went off meanwhile -- write nothing) */
  wanted: () => boolean;
}

export type LiveReimport =
  | { ok: true; rows: number; reshaped: boolean; labelled: boolean; stamp: string; held: boolean; data: DataStruct }
  /** `stale`: the worksheet changed while the file was read, or the file did
   *  (409): nothing was written; the next poll retries. `early`: a held read of a
   *  file with no complete line yet (425): nothing to read until it holds still. */
  | { ok: false; stale: boolean; early?: boolean; error: string };

/** A read that has not answered by now is abandoned (a share that dropped after its stat). */
export const READ_TIMEOUT_MS = 120_000;

/** Push a labelled undo step for the CURRENT state without clearing redo (rule 1), in ONE
 *  store write with history.ts's own seq: restoring `future` after a plain `recordHistory` would
 *  show subscribers a moment with redo empty, and store/projectFollowsHistory.ts prunes the
 *  records of entries that leave both stacks (a project swap waiting in redo would lose its). */
function pushStep(get: SliceGet, label: string): number | undefined {
  get().recordHistory(label, undefined, true);
  return get().history.at(-1)?.seq;
}

/** Re-read `id`'s source file and install it in place. Never throws; on any
 *  failure the dataset is left exactly as it was. */
export async function liveReimport(set: SliceSet, get: SliceGet, id: string, shared: ImportCache, opts: LiveOpts): Promise<LiveReimport> {
  const ds = get().datasets.find((d) => d.id === id);
  if (!ds?.source) return { ok: false, stale: false, error: "the worksheet no longer has a source file" };
  try {
    const key = `${opts.hold ? 1 : 0}\0${ds.source.path}`;
    const pending = shared.get(key) ?? importLive(ds.source.path, opts.hold, AbortSignal.timeout(READ_TIMEOUT_MS));
    shared.set(key, pending);
    const read = await pending;
    const freshRaw = await resolveFreshData(ds, read.data);
    const diverged = opts.base !== null && !holdsFileRows(ds, opts.base);
    const own = ds.corrections && ds.raw ? ds.raw : ds.data;
    // Nothing new: the worksheet already holds exactly the file's rows (a first read adopts them
    // as the installed generation), or a held read is a prefix of them (the file's unterminated
    // last line was read earlier, by the import or a read that did not hold: never shrink).
    const sameRows = freshRaw.time.length === own.time.length || (read.held && freshRaw.time.length < own.time.length);
    const nothingNew = !diverged && sameRows && !reimportColumnsChanged(ds, freshRaw) && rowsArePrefix(freshRaw, own, reimportBaseCols(ds));
    const merge = nothingNew ? null : await computeReimportMerge(get, ds, freshRaw, { base: opts.base ?? undefined, skipLast: true });
    // Anything awaited above may have let the user (or a project switch) change this worksheet;
    // a store update replaces the dataset object, so identity is the whole-worksheet check.
    if (get().datasets.find((d) => d.id === id) !== ds) return { ok: false, stale: true, error: "the worksheet changed while its file was being read" };
    if (!opts.wanted()) return { ok: false, stale: false, error: "auto-update was turned off" };
    if (!merge) {
      // Nothing rewritten but the source baseline -- and that only when the worksheet holds
      // everything read (a held line it lacks would make Relink/Pack and a reopen call it complete).
      if (!read.held || own.time.length > freshRaw.time.length) stampSource(set, id, ds, read);
      return { ok: true, rows: own.time.length, reshaped: false, labelled: false, stamp: read.stamp, held: read.held, data: ds.data };
    }
    // Diverged but holding untouched OLDER file data (an undo past a formula-column add, say):
    // nothing of the user's is replaced, so it is not called "your edits".
    const edits = diverged && !untouchedPrefix(ds, freshRaw);
    const label = edits
      ? "Auto-update replaced your edits"
      : diverged
        ? "Auto-update (newer file data)"
      : merge.shapeChanged
        ? "Auto-update (the file's shape changed)"
        : opts.base === null
          ? "Auto-update (first read of the file)"
          : null;
    const stepSeq = label ? pushStep(get, label) : undefined;
    applyReimportMerge(set, get, ds, merge, undefined, true);
    if (!read.held) stampSource(set, id, ds, read); // a held read is not the whole file
    const next = get().datasets.find((d) => d.id === id);
    if (next && opts.base && !merge.shapeChanged) rebaseHistory(set, ds, opts.base, next, stepSeq);
    // A reshape already toasts from applyReimportMerge ("changed shape on re-import").
    if (label && (edits || !merge.shapeChanged)) toast(edits ? `Auto-update replaced your edits to "${ds.name}" with the file's newer data. Undo (Ctrl+Z) brings them back.` : `"${ds.name}" was updated from its file (undoable).`, "info");
    return { ok: true, rows: merge.newData.time.length, reshaped: merge.shapeChanged, labelled: label !== null, stamp: read.stamp, held: read.held, data: next?.data ?? merge.newData };
  } catch (e) {
    if (e instanceof HttpError && e.status === 409) return { ok: false, stale: true, error: e.message };
    if (e instanceof HttpError && e.status === 425) return { ok: false, stale: false, early: true, error: e.message };
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

/** Point every undo/redo snapshot's copy of worksheet `id` that still holds the file rows `base`
 *  at `next`'s rows and source baseline -- except the step this very update pushed (`skipSeq`). */
function rebaseHistory(set: SliceSet, ds: Dataset, base: DataStruct, next: Dataset, skipSeq: number | undefined): void {
  const id = ds.id;
  const fix = (list: HistoryEntry[]): HistoryEntry[] =>
    list.map((e) => {
      const held = e.seq === skipSeq ? undefined : e.snapshot.datasets.find((d) => d.id === id);
      // Same file rows AND the same formula columns / corrections as the worksheet just updated,
      // so `next`'s columns mean the same thing in that snapshot.
      if (!held || held.formulas !== ds.formulas || held.corrections !== ds.corrections || !holdsFileRows(held, base)) return e;
      const datasets = e.snapshot.datasets.map((d) => (d.id === id ? { ...d, data: next.data, source: next.source, ...(d.raw ? { raw: next.raw } : {}) } : d));
      return { ...e, snapshot: { ...e.snapshot, datasets } };
    });
  set((s) => ({ history: fix(s.history), future: fix(s.future) }));
}
