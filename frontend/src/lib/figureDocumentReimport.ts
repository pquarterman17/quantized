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
//
// LIBRARY_WORKBOOK_UX_PLAN PR M booked finding (G5 canonical-state review,
// 2026-08-17): groupKey/facetKey were PREVIOUSLY left untouched here (the
// established window-path reset preserves them too), but groupKey reaches
// the backend as FigureSpec.group_col (lib/figureSpec.ts) for Publication
// Preview/export — a stale index for a removed/shifted grouping column
// raised a raw `ValueError` there instead of a clear message. Cleared here
// like every other channel-indexed binding: once null, figureSpec.ts omits
// `group_col` entirely (no backend call, no crash), and the CALLER
// (store/reimport.ts's commitReimport) surfaces a clear "grouping column no
// longer exists" toast for exactly the figures this actually resets, so the
// loss is never silent. facetKey was inert at the time of this booked
// finding (no renderer read it yet) but is cleared alongside groupKey for
// the same reason and to avoid two diverging rules for two structurally
// identical bindings — a call FIGURE_AUTHORING_WORKFLOW_PLAN F4.4 (2026-08-23)
// vindicated: facetKey is now a live wire (`MultiPanelStage.tsx`'s
// `facetCompositionFromBinding` fallback renders a facet grid straight off
// it), so a stale index here would no longer be silent either — it would
// facet the reshaped dataset on the WRONG column.
//
// The reset is unconditional WHEN CALLED; the gate lives at the call site
// (lib/reimport.ts's `reimportColumnsChanged`). An in-range binding is not
// proof of freshness — a column-count change can leave old indices in range
// while their meaning shifts, which is exactly the silent-wrong-columns
// hazard this exists to close. Row-only reshapes never reach here: column
// meaning is provably intact then, and a saved document is a durable
// artifact worth preserving (unlike the live view, which resets on any
// shape change because the user is actively looking at it).
//
// SILENT_STATE_CORRUPTION_PLAN #9: `document.publication.seriesStyles` is a
// POSITIONAL `(ExportSeriesStyle | null)[]` outside this field list above —
// and it WINS over every field this function resets: lib/figureSpec.ts's
// buildFigureSpecFromDocument only derives styles from the (freshly reset)
// view when `publicationSeriesStyles === undefined`. Left behind, a
// one-entry array built for a one-channel figure survives verbatim onto a
// reset that just widened the plotted set to every surviving channel — so
// the export replays it at the WRONG position (index 0 now means a
// different, newly-added channel) instead of deriving fresh per-channel
// styles the way the reset view's own (also-cleared) `seriesStyles` map
// intends. Cleared to `undefined` here — the sibling `overrides` field has
// no channel-position fields of its own (grid/margins/ticks/annotations use
// fixed axes coordinates, never a channel index) and is left alone.
import type { FigureDocument } from "./figureDocument";

/**
 * Reset `document`'s channel-indexed state after its bound dataset's column
 * layout changed on reimport. Field-for-field mirror of commitReimport's
 * shape-changed reset (see module doc): xKey/yKeys/y2Keys clear to PlotView's
 * "automatic/all channels" `null` sentinel, errors clear to `[]` (the same
 * "fresh/empty" outcome `resetErrors: true` produces on the window path),
 * groupKey/facetKey clear to `null` (PR M booked finding — see module doc),
 * and the matching channel-indexed plot.view fields (seriesOrder,
 * hiddenChannels, seriesStyles, seriesLabels) plus the axis-range fields
 * datasetViewDefaults bundles with them (xLim/yLim/xStep/yStep,
 * y2Lim/y2Scale/y2Step/y2AxisLabel) reset alongside them. `publication.
 * seriesStyles` (task #9 — see module doc) clears to `undefined` too, so
 * export re-derives it from the just-reset view instead of replaying a
 * stale positional array; `publication.overrides` has no channel-position
 * fields and is left untouched. Never mutates.
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
      groupKey: null,
      facetKey: null,
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
    ...(document.publication?.seriesStyles === undefined
      ? {}
      : { publication: { ...document.publication, seriesStyles: undefined } }),
  };
}
