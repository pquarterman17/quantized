// Async preflight for applying an imported Origin figure (#48). Keeps lazy
// source resolution and latest-request-wins coordination out of useApp.ts.

import { figureLayerFamily, type OriginFigureEntry } from "../lib/originFigures";
import type { Dataset } from "../lib/types";
import type { AppState } from "./useApp";
import { toast } from "./toasts";

type GetApp = () => AppState;

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
  opts?: { newWindow?: boolean },
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
