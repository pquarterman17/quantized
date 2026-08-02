// Reshape reset for a SAVED editable FigureDocument (F1 + MAIN_PLAN #10).
//
// A shape-changing reimport (lib/reimport.ts's reimportShapeChanged) already
// resets the live view AND every bound plotWindows entry's channel-indexed
// state — store/reimport.ts's commitReimport does it via
// store/windowDefaults.ts's datasetViewDefaults (the live-view branch) and
// store/windowDocuments.ts's syncPlotWindow called with `resetErrors: true`
// (the window-walk branch, which itself routes through
// createPlotWindowDocument with `errors: null`, i.e. "derive fresh bindings
// from the view's own errKeys instead" per that option's own doc comment).
//
// `store/figureLifecycle.ts`'s `editableFigures` is neither of those — a
// saved, possibly-closed FigureDocument — so commitReimport never touched it
// (figureLifecycle.ts landed in commit 4bdd56c, AFTER reimport.ts's last
// revision 40d4556). Its bindings.xKey/yKeys/y2Keys/errors and its
// plot.view's channel-indexed fields (seriesOrder/hiddenChannels/
// seriesStyles/seriesLabels) kept indexing the OLD column layout, and
// silently rendered/exported the WRONG columns when reopened after a
// shape-changing reimport of its bound dataset.
//
// This mirrors the established reset's FIELD LIST exactly (never invents a
// different one — see datasetViewDefaults's object literal): xKey, yKeys,
// y2Keys, y2Lim, y2Scale, y2Step, y2AxisLabel, seriesStyles, seriesLabels,
// errKeys/errors, seriesOrder, hiddenChannels, xLim, yLim, xStep, yStep.
// groupKey/facetKey are deliberately left untouched — the established reset
// preserves them too (createPlotWindowDocument always carries
// `previous?.bindings.groupKey`/`facetKey` forward, even under
// `resetErrors: true`), so a different choice here would be inventing a new
// list, not mirroring the old one.
//
// The reset is unconditional WHEN CALLED; the gate lives at the call site
// (lib/reimport.ts's `reimportColumnsChanged`). An in-range binding is not
// proof of freshness — a column-count change can leave old indices in range
// while their meaning shifts, which is exactly the silent-wrong-columns
// hazard this exists to close. Row-only reshapes never reach here: column
// meaning is provably intact then, and a saved document is a durable
// artifact worth preserving (unlike the live view, which resets on any
// shape change because the user is actively looking at it).
import type { FigureDocument } from "./figureDocument";

/**
 * Reset `document`'s channel-indexed state after its bound dataset's column
 * layout changed on reimport. Field-for-field mirror of commitReimport's
 * shape-changed reset (see module doc): xKey/yKeys/y2Keys clear to PlotView's
 * "automatic/all channels" `null` sentinel, errors clear to `[]` (the same
 * "fresh/empty" outcome `resetErrors: true` produces on the window path),
 * and the matching channel-indexed plot.view fields (seriesOrder,
 * hiddenChannels, seriesStyles, seriesLabels) plus the axis-range fields
 * datasetViewDefaults bundles with them (xLim/yLim/xStep/yStep,
 * y2Lim/y2Scale/y2Step/y2AxisLabel) reset alongside them. Never mutates.
 */
export function resetFigureDocumentForReshape(document: FigureDocument): FigureDocument {
  return {
    ...document,
    bindings: {
      ...document.bindings,
      xKey: null,
      yKeys: null,
      y2Keys: null,
      errors: [],
    },
    plot: {
      ...document.plot,
      view: {
        ...document.plot.view,
        seriesOrder: null,
        hiddenChannels: [],
        seriesStyles: {},
        seriesLabels: {},
        xLim: null,
        yLim: null,
        xStep: null,
        yStep: null,
        y2Lim: null,
        y2Scale: null,
        y2Step: null,
        y2AxisLabel: "",
      },
    },
  };
}
