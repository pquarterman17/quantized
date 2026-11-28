// Keeps every LIVE link to a named range current (ROW_RANGE_CONTRACT 5.2, `rowRange = { named: id }`). A plot window
// and an analysis input that follow a named range hold a `RowRange` with `named` set; its `from` and `to` are a cache
// of what the name covers now (lib/rangeLink.ts), so the plot's mask, the export and the analysis resolver, which read
// `from` and `to`, need no second path. This module is the one place that re-reads the cache: after any change to the
// named ranges, the sheets (a row insert or delete, a re-import), the focused view or the windows.
//
// The write is never a history entry. The edits that change what a link covers (a retarget, an insert, a delete, a
// range delete) record their own undo step, whose snapshot holds the named ranges AND the views, and an undo is
// followed by this sync, so one Ctrl+Z restores the range and the link together.
//
// FIGURE DOCUMENTS. A saved editable figure (`editableFigures`) made from a plot that follows a named range keeps the
// link in its view, `{ named: id }` plus the cached rows, and follows the range the way the plot window does: the
// figure page, the Library export and Publication Preview read that cache, so it is re-read here too. A FROZEN document
// does not follow (ROW_RANGE_CONTRACT 3.3: it holds its data snapshot, and the range is resolved when it is frozen; its
// cached rows index THAT snapshot, so re-reading them against the live sheet would cut the wrong rows). Its state is
// shown in the Library ("rows frozen from range X") and `store/figureRangeRelink.ts` offers "Re-link to range".
//
// Installed once, on demand: when a link is made (`linkPlotRowRange`, `analysisInputFromNamedRange`) and when a loaded
// project holds one (`installIfLinked`, called from the project load). It does nothing while no link exists.

import { resolveRangeLink, sameLink } from "../lib/rangeLink";
import type { RowRange } from "../lib/rowRange";
import { useAnalysisSelection } from "./analysisSelection";
import { registerNamedRangeDependants, type NamedRangeDependant, type NamedRangeDependants } from "./namedRanges";
import type { FigureDocument } from "../lib/figureDocument";
import { useApp, type AppState } from "./useApp";
import { plotWindowDatasetId, plotWindowView, syncPlotWindow } from "./windowDocuments";

const linked = (range: RowRange | null | undefined): range is RowRange & { named: string } => !!range?.named;
/** A window's saved range, read without rebuilding its view (this runs on every sheet edit while a link exists). */
const windowRange = (w: AppState["plotWindows"][number]): RowRange | undefined => (w.document?.data.mode === "frozen" ? undefined : (w.document?.plot.view ?? w.view)?.rowRange);
/** A LIVE saved figure's window; a frozen one holds its own snapshot and never follows. */
// Optional chaining: a partial document (an older file, a test fixture) may lack `data` or `plot`; it holds no link.
const figureRange = (d: FigureDocument): RowRange | undefined => (d?.data?.mode === "frozen" ? undefined : d?.plot?.view?.rowRange);

/** Is any plot view or analysis input holding a named link? */
export function hasRangeLinks(s: AppState = useApp.getState()): boolean {
  return (
    linked(s.rowRange) ||
    s.plotWindows.some((w) => w.kind === "plot" && linked(windowRange(w))) ||
    s.editableFigures.some((d) => linked(figureRange(d))) ||
    !!useAnalysisSelection.getState().selection?.items.some((item) => linked(item.rowRange))
  );
}

/** Re-read every link against the current named ranges and sheets, writing only what changed. */
export function syncRangeLinks(): void {
  const s = useApp.getState();
  const patch: Partial<AppState> = {};
  if (linked(s.rowRange) && s.activeId) {
    const next = resolveRangeLink(s.rowRange.named, s.activeId, s.namedRanges, s.datasets, s.rowRange.namedAs);
    if (!sameLink(s.rowRange, next)) patch.rowRange = next;
  }
  let windows = s.plotWindows;
  windows = windows.map((w) => {
    if (w.kind !== "plot" || w.id === s.focusedWindowId) return w;
    if (!linked(windowRange(w))) return w;
    const view = plotWindowView(w);
    const dataset = plotWindowDatasetId(w);
    if (!linked(view.rowRange) || !dataset) return w;
    const next = resolveRangeLink(view.rowRange.named, dataset, s.namedRanges, s.datasets, view.rowRange.namedAs);
    return sameLink(view.rowRange, next) ? w : syncPlotWindow(w, { ...view, rowRange: next });
  });
  if (windows.some((w, i) => w !== s.plotWindows[i])) patch.plotWindows = windows;
  const figures = s.editableFigures.map((d) => {
    const range = figureRange(d);
    const dataset = d.bindings.datasetId;
    if (!linked(range) || !dataset) return d;
    const next = resolveRangeLink(range.named, dataset, s.namedRanges, s.datasets, range.namedAs);
    return sameLink(range, next) ? d : { ...d, plot: { ...d.plot, view: { ...d.plot.view, rowRange: next } } };
  });
  if (figures.some((d, i) => d !== s.editableFigures[i])) patch.editableFigures = figures;
  if (Object.keys(patch).length) useApp.setState(patch);

  const held = useAnalysisSelection.getState().selection;
  if (held?.items.some((item) => linked(item.rowRange))) {
    let changed = false;
    const items = held.items.map((item) => {
      if (!linked(item.rowRange)) return item;
      const next = resolveRangeLink(item.rowRange.named, item.datasetId, s.namedRanges, s.datasets, item.rowRange.namedAs);
      if (sameLink(item.rowRange, next)) return item;
      changed = true;
      return { ...item, rowRange: next };
    });
    if (changed) useAnalysisSelection.setState({ selection: { ...held, items } });
  }
}

/** The plot windows and analysis inputs that follow range `id`, for the delete dialog (store/namedRanges registers this). A
 *  confirmed delete needs no patch: a link holds the range's id and ids are never reused, so once the range is gone the
 *  sync marks each link refused ("the named range was removed") and it can never re-bind to a later range of the same
 *  name; the delete's own undo step restores the range, and the sync then re-reads the links. */
export const rangeLinkDependants: NamedRangeDependants = {
  find: (s, id) => {
    const out: NamedRangeDependant[] = [];
    const name = (datasetId: string | null | undefined): string => s.datasets.find((d) => d.id === datasetId)?.name ?? "a worksheet";
    if (s.rowRange?.named === id) out.push({ kind: "plot", label: `the plot of ${name(s.activeId)}` });
    for (const w of s.plotWindows) {
      if (w.kind === "plot" && w.id !== s.focusedWindowId && windowRange(w)?.named === id) out.push({ kind: "plot", label: `plot window "${w.title}" (${name(plotWindowDatasetId(w))})` });
    }
    for (const d of s.editableFigures) {
      if (figureRange(d)?.named === id) out.push({ kind: "figure", label: `the editable figure "${d.name}" (${name(d.bindings.datasetId)})` });
    }
    for (const item of useAnalysisSelection.getState().selection?.items ?? []) {
      if (item.rowRange?.named === id) out.push({ kind: "analysis input", label: `the analysis input on ${name(item.datasetId)}` });
    }
    return out;
  },
  cut: () => ({}),
};

registerNamedRangeDependants(rangeLinkDependants);

let unsubscribe: (() => void) | null = null;

/** Start following (idempotent). The listener reads references only until a link exists. */
export function installRangeLinkSync(): void {
  if (unsubscribe) {
    syncRangeLinks();
    return;
  }
  const off = [
    useApp.subscribe((s, prev) => {
      if (s.namedRanges !== prev.namedRanges || s.datasets !== prev.datasets || s.rowRange !== prev.rowRange || s.plotWindows !== prev.plotWindows || s.editableFigures !== prev.editableFigures || s.activeId !== prev.activeId) {
        if (hasRangeLinks(s)) syncRangeLinks();
      }
    }),
    useAnalysisSelection.subscribe((s, prev) => {
      if (s.selection !== prev.selection && s.selection?.items.some((item) => linked(item.rowRange))) syncRangeLinks();
    }),
  ];
  unsubscribe = () => off.forEach((f) => f());
  syncRangeLinks();
}

/** For tests: stop following. */
export function resetRangeLinkSyncForTests(): void {
  unsubscribe?.();
  unsubscribe = null;
}

/** A loaded project may hold links (placeholders until read): start following if so. */
export function installIfLinked(): void {
  if (hasRangeLinks()) installRangeLinkSync();
}
