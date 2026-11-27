// Row ranges follow row edits (ROW_RANGE_CONTRACT 3.2). A range is positions, so
// insert and delete remap it exactly as they remap `excludedRows` (lib/rowRange
// over lib/rowShift); sort and Move rows leave it alone and say so. Two things
// hold a range: the transient analysis selection, and (R2) a plot VIEW, the
// focused window's live one and every other window's document. This is the one
// place that has to hear about a row operation. The callers record their own undo
// step first, and its snapshot holds the views (`snapshotView`, `plotWindows`),
// so one undo restores the data and the windows together.

import { markNamedRangesRowsStale, shiftNamedRangesForDelete, shiftNamedRangesForInsert, type NamedRange } from "../lib/namedRanges";
import { rowRangeLabel, shiftRangeForDelete, shiftRangeForInsert, type RowRange } from "../lib/rowRange";
import { useAnalysisSelection } from "./analysisSelection";
import { useApp } from "./useApp";
import { plotWindowDatasetId, plotWindowView, syncPlotWindow } from "./windowDocuments";

type Shift = (range: RowRange) => RowRange;

/** Every plot view of `datasetId` that holds a range: the focused live one, then
 *  the other windows'. A window whose rows were all deleted loses the range (a
 *  display preference: one undo restores it), and the status line says so. */
function mapPlotRanges(datasetId: string, shift: Shift): void {
  const app = useApp.getState();
  const settle = (range: RowRange): RowRange | undefined => {
    const next = shift(range);
    return next.was === undefined ? next : undefined;
  };
  const lost: string[] = [];
  const track = (range: RowRange): RowRange | undefined => {
    const next = settle(range);
    if (!next) lost.push(rowRangeLabel(range));
    return next;
  };
  const hasLive = app.activeId === datasetId && !!app.rowRange;
  const live = hasLive ? track(app.rowRange!) : undefined;
  const windows = app.plotWindows.map((w) => {
    if (w.kind !== "plot" || w.id === app.focusedWindowId || plotWindowDatasetId(w) !== datasetId) return w;
    const view = plotWindowView(w);
    return view.rowRange ? syncPlotWindow(w, { ...view, rowRange: track(view.rowRange) }) : w;
  });
  if (!hasLive && windows.every((w, i) => w === app.plotWindows[i])) return;
  useApp.setState({ ...(hasLive ? { rowRange: live } : {}), plotWindows: windows });
  if (lost.length) app.setStatus(`${lost.join(", ")} no longer exist${lost.length === 1 ? "s" : ""}: the plot row range was cleared`);
}

function plotRangeCount(datasetId: string): number {
  const app = useApp.getState();
  const others = app.plotWindows.filter((w) => w.kind === "plot" && w.id !== app.focusedWindowId && plotWindowDatasetId(w) === datasetId && plotWindowView(w).rowRange).length;
  return others + (app.activeId === datasetId && app.rowRange ? 1 : 0);
}

function mapRanges(datasetId: string, shift: (range: NonNullable<ReturnType<typeof ranges>[number]["rowRange"]>) => ReturnType<typeof shiftRangeForInsert>): void {
  const { selection, toolId, offeredRanges } = useAnalysisSelection.getState();
  // A range offered back ("Use it") is by position too: it follows the edit, or is no longer offered.
  const offered = offeredRanges[datasetId];
  if (offered) useAnalysisSelection.setState({ offeredRanges: { ...offeredRanges, [datasetId]: shift(offered) } });
  if (!selection || toolId === null || !ranges(datasetId).length) return;
  useAnalysisSelection.setState({
    selection: {
      ...selection,
      items: selection.items.map((item) => item.datasetId === datasetId && item.rowRange ? { ...item, rowRange: shift(item.rowRange) } : item),
    },
  });
}

function ranges(datasetId: string) {
  return (useAnalysisSelection.getState().selection?.items ?? []).filter((item) => item.datasetId === datasetId && item.rowRange);
}

/** Named ranges (R4a) are positions too: they follow the edit inside the caller's own undo step (its snapshot holds
 *  `namedRanges`). A range whose rows were all deleted is kept, flagged, never widened. */
function shiftNamedRanges(next: (ranges: NamedRange[]) => NamedRange[]): void {
  const before = useApp.getState().namedRanges;
  const after = next(before);
  if (after !== before) useApp.setState({ namedRanges: after });
}

/** The sheet's rows were REPLACED rather than edited (a trim, a re-derive, a re-import that changed the row count): a
 *  named range's positions have lost their meaning, so each row-limited one on it is flagged stale (never widened, never
 *  guessed at; ROW_RANGE_CONTRACT 5.4) and its readers refuse until the user keeps or removes the limit. `whole`: the
 *  columns were replaced too, so the unlimited ranges are flagged as well. */
export function markRowsReplaced(datasetId: string, rowsChanged: boolean, whole = false): void {
  if (rowsChanged) shiftNamedRanges((r) => markNamedRangesRowsStale(r, datasetId, whole));
}

export function shiftRowRangesForInsert(datasetId: string, at: number, count: number): void {
  shiftNamedRanges((r) => shiftNamedRangesForInsert(r, datasetId, at, count));
  mapRanges(datasetId, (range) => shiftRangeForInsert(range, at, count));
  mapPlotRanges(datasetId, (range) => shiftRangeForInsert(range, at, count));
}

export function shiftRowRangesForDelete(datasetId: string, deleted: ReadonlySet<number>): void {
  shiftNamedRanges((r) => shiftNamedRangesForDelete(r, datasetId, deleted));
  mapRanges(datasetId, (range) => shiftRangeForDelete(range, deleted));
  mapPlotRanges(datasetId, (range) => shiftRangeForDelete(range, deleted));
}

/** Status-line note for a sort or Move rows: a range is by position, so it now
 *  covers different rows. "" when this worksheet has none. */
export function rowRangeOrderNote(datasetId: string): string {
  const count = ranges(datasetId).length + plotRangeCount(datasetId) + useApp.getState().namedRanges.filter((r) => r.target.datasetId === datasetId && r.target.rows && !r.rowsStale).length;
  return count ? `; ${count} row range${count === 1 ? " is" : "s are"} by position and now cover${count === 1 ? "s" : ""} different rows` : "";
}
