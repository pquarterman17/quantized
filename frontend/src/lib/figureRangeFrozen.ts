// A FROZEN saved figure that was made from a plot following a named range (ROW_RANGE_CONTRACT 3.3: "a frozen figure
// document already holds its snapshot, so the range is resolved when it is frozen"). Pure: no store, no React.
//
// Frozen on purpose: its cached rows index the SNAPSHOT it holds, so nothing re-reads them (store/rangeLinkSync.ts skips
// it). What it owes the user is to SAY so, and to offer the way back: "Re-link to range", which makes it a live figure
// that follows the range again. That is never done silently, and it fails closed (the plan below says why not).

import type { FigureDocument } from "./figureDocument";
import { namedRangeIssue, type NamedRange } from "./namedRanges";
import type { Dataset } from "./types";

/** "rows frozen from range Base", or null when `doc` is not a frozen figure made from a named range. The wording the
 *  Library shows beside the figure. */
export function frozenRangeNote(doc: FigureDocument): string | null {
  // `?.`: a Library fixture or a hand-built node may carry a partial document; none is "frozen from a range".
  const range = (doc.data as FigureDocument["data"] | undefined)?.mode === "frozen" ? doc.plot.view.rowRange : undefined;
  return range?.named ? `rows frozen from range ${range.namedAs ?? "(unnamed)"}` : null;
}

export type RelinkPlan =
  | { ok: true; range: NamedRange; dataset: Dataset }
  | { ok: false; reason: string };

/** Can the frozen figure `doc` follow its named range again? Only when the very range it was frozen from (by id, never by
 *  name) still exists, reads, and sits on a worksheet whose columns are the snapshot's own: otherwise the figure's
 *  channel numbers would mean other columns. `windowOpen`: a window holds its own copy of the document, so re-linking
 *  under it would leave two figures with one id. */
export function relinkPlan(doc: FigureDocument, ranges: readonly NamedRange[], datasets: readonly Dataset[], windowOpen: boolean): RelinkPlan {
  const link = doc.data.mode === "frozen" ? doc.plot.view.rowRange : undefined;
  if (doc.data.mode !== "frozen" || !link?.named) return { ok: false, reason: "this figure is not a frozen figure made from a named range" };
  const range = ranges.find((r) => r.id === link.named);
  if (!range) return { ok: false, reason: `named range ${link.namedAs ?? ""} was removed, so there is nothing to follow` };
  const dataset = datasets.find((d) => d.id === range.target.datasetId);
  if (!dataset) return { ok: false, reason: `the worksheet of named range ${range.name} no longer exists` };
  if (dataset.pending != null) return { ok: false, reason: `${dataset.name} is still loading: open it, then try again` };
  const issue = namedRangeIssue(range, datasets);
  if (issue) return { ok: false, reason: issue };
  const frozen = doc.data.snapshot!;
  if (frozen.labels.length !== dataset.data.labels.length || frozen.labels.some((l, i) => l !== dataset.data.labels[i])) {
    return { ok: false, reason: `${dataset.name} no longer has the columns this figure was frozen from, so following ${range.name} would plot other data` };
  }
  if (windowOpen) return { ok: false, reason: "close the window showing this figure first" };
  return { ok: true, range, dataset };
}
