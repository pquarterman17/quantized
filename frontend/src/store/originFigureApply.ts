// Async preflight for applying an imported Origin figure (#48). Keeps lazy
// source resolution and latest-request-wins coordination out of useApp.ts.

import { askConfirm } from "../components/overlays/ConfirmDialog";
import { figureLayerFamily, type OriginFigureEntry } from "../lib/originFigures";
import { excludedSet } from "../lib/rowstate";
import type { Dataset } from "../lib/types";
import type { AppState } from "./useApp";
import { toast } from "./toasts";

type GetApp = () => AppState;
type ApplyOpts = { newWindow?: boolean; discardConfirmed?: boolean };

let applySeq = 0;

/** Dataset ids whose FULL data an Origin figure application may read.
 *
 * The clicked layer is not enough: a graph window may contain spatial sibling
 * layers, and one layer may bind curves from several books. Scope every lookup
 * to the entry's import siblings so Origin's ubiquitous Book1/Book2 names can
 * never pull data from another project. */
function sourceDatasetIds(
  entry: OriginFigureEntry,
  figures: OriginFigureEntry[],
  datasets: Dataset[],
): string[] {
  const siblingSet = new Set(entry.siblingIds);
  const family = figureLayerFamily(entry, figures);
  const relevant = family.length > 0 ? family : [entry];
  const ids = new Set<string>();
  const books = new Set<string>();
  for (const member of relevant) {
    if (member.datasetId && siblingSet.has(member.datasetId)) ids.add(member.datasetId);
    for (const curve of member.figure.curves ?? []) books.add(curve.book);
  }
  if (books.size > 0) {
    for (const ds of datasets) {
      if (!siblingSet.has(ds.id)) continue;
      const book = String((ds.data.metadata ?? {}).origin_book ?? "");
      if (books.has(book)) ids.add(ds.id);
    }
  }
  return [...ids];
}

/** Return true when application was deferred for lazy source resolution.
 *
 * Every invocation advances the sequence, including an already-resolved
 * synchronous apply. A slow older fetch can therefore never overwrite the
 * newer graph the user selected. */
export function deferOriginFigureApply(
  get: GetApp,
  entry: OriginFigureEntry,
  id: string,
  opts?: ApplyOpts,
): boolean {
  const requestSeq = ++applySeq;
  const sourceIds = sourceDatasetIds(entry, get().originFigures, get().datasets);
  const pendingIds = sourceIds.filter(
    (sourceId) => get().datasets.find((d) => d.id === sourceId)?.pending != null,
  );
  if (pendingIds.length === 0) return false;

  get().setStatus(`loading ${pendingIds.length} Origin source book${pendingIds.length === 1 ? "" : "s"}…`);
  void get()
    .resolveDatasets(pendingIds)
    .then(() => {
      if (applySeq !== requestSeq) return;
      // Re-enter after every source swap lands. The second pass sees no
      // pending ids and executes useApp's existing synchronous apply path.
      get().applyOriginFigure(id, opts);
    })
    .catch((error: unknown) => {
      if (applySeq !== requestSeq) return;
      const message = error instanceof Error ? error.message : "source book fetch failed";
      get().setStatus(`couldn't apply Origin figure — ${message}`);
      toast(`couldn't apply Origin figure — ${message}`, "danger");
    });
  return true;
}

/** Human-readable list of the user edits `originOverlayDataset` would drop on
 *  a rebuild, or null when the existing overlay carries none. Mirrors exactly
 *  the fields that function does NOT carry forward (it only preserves id/
 *  name/data plus notes/tags/group/folderId/order) — corrections (folded
 *  bgRef counts as the same edit), worksheet formulas, the row filter,
 *  excluded rows, and a recorded fit. `raw`/`channelRoles`/`channelTypes`/
 *  `pending`/`source` are also dropped but are bookkeeping, not user work,
 *  so they're not called out here. */
function discardedEdits(d: Dataset): string[] | null {
  const parts: string[] = [];
  if (d.corrections || d.bgRef) parts.push("corrections");
  if (d.formulas?.length) {
    parts.push(`${d.formulas.length} formula${d.formulas.length === 1 ? "" : "s"}`);
  }
  if (d.filter?.length) parts.push("row filter");
  if (excludedSet(d).size > 0) parts.push("excluded rows"); // via rowstate — guard #50
  if (d.fitSpec) parts.push("fit");
  return parts.length > 0 ? parts : null;
}

/** Gate item #57: re-applying a figure that already has a materialized
 *  overlay rebuilds it from source (see originOverlayDataset), silently
 *  discarding any row/column-indexed edits on the existing dataset. Ask
 *  first when there is something to lose; a first-ever apply or a re-apply
 *  of an edit-free overlay stays silent.
 *
 *  Runs BEFORE deferOriginFigureApply: the edit check needs no source
 *  resolution, so confirming first is both correct (a cancelled re-apply
 *  never starts a book fetch) and cheaper.
 *
 *  Sequence counter: this shares `applySeq` with deferOriginFigureApply so a
 *  pending confirm participates in the same latest-request-wins ordering —
 *  applying a DIFFERENT figure (or the same one again) while this dialog is
 *  open bumps `applySeq` again (via this function or deferOriginFigureApply,
 *  whichever the newer call reaches), so an eventual "confirm" on the stale
 *  dialog is detected as superseded and silently does nothing instead of
 *  clobbering the newer apply.
 *
 *  Returns true when a confirm was launched (the apply, if any, happens
 *  later via the `discardConfirmed` re-entry); false to proceed synchronously
 *  right now. */
export function confirmOriginReapplyDiscard(
  get: GetApp,
  entry: OriginFigureEntry,
  id: string,
  opts?: ApplyOpts,
): boolean {
  if (opts?.discardConfirmed) return false;
  const existing = get().datasets.find(
    (d) => (d.data.metadata ?? {}).origin_overlay_source === entry.id,
  );
  if (!existing) return false;
  const edits = discardedEdits(existing);
  if (!edits) return false;

  const requestSeq = ++applySeq;
  void askConfirm(
    "Re-apply Origin figure?",
    `"${existing.name}" has user edits that will be discarded: ${edits.join(", ")}.`,
    "Re-apply",
    true,
  ).then((ok) => {
    if (!ok || applySeq !== requestSeq) return;
    get().applyOriginFigure(id, { ...opts, discardConfirmed: true });
  });
  return true;
}
