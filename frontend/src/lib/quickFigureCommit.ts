// Quick Figure Builder -> canonical FigureDocument bridge (plan G4). Pure
// converter: (dataset, mapping, style) -> the pieces of
// CreateFigureDocumentInput the store action (store/quickFigureCreate.ts)
// feeds straight into `createFigureDocument`. No id minting, no name
// dedupe, no store/window reads -- those are the ACTION's job (mirrors
// lib/quickPlot.ts's `quickPlotFigureSeed` / store/quickPlotAction.ts split).
//
// The view seed starts from `defaultPlotView()` and overlays ONLY the
// mapping's own x/y/group/label decisions -- it deliberately does NOT blend
// `datasetViewDefaults`/`techniqueViewMemory` (the auto-inference every
// other figure-creation path layers in). The builder's mapping IS the
// user-confirmed replacement for that inference: the whole point of running
// the Quick Figure Builder is to pin down explicit column roles instead of
// trusting a per-technique or remembered guess, so re-applying that guess on
// top would silently override what the user just chose. `yKeys` is an
// EXPLICIT whitelist (never the null "all channels" sentinel) -- ignored,
// error, label, and group columns are excluded simply by never appearing in it;
// this is NOT the same mechanism as `hiddenChannels` (a plotted-but-hidden
// toggle) and must not be confused with it.

import type { ErrorBinding } from "./errorRoles";
import { defaultPlotView, type PlotView } from "./plotview";
import type { PlotMark } from "./plotspec";
import { quickFigurePointLabels } from "./quickFigureLabels";
import type { QuickFigureMapping } from "./quickFigureMapping";
import type { QuickPlotStyle } from "./quickFigurePreview";
import { quickFigureOverlay, type QuickFigureOverlay } from "./quickFigureSeriesX";
import type { Dataset, SeriesStyle } from "./types";

/** The pieces of `CreateFigureDocumentInput` this converter can determine
 *  from (dataset, mapping, style) alone -- id/datasetId are minted/known by
 *  the caller, and `name` here is the UNDEDUPED base (the action dedupes
 *  against `editableFigures`, mirroring `quickPlotFigureSeed`). */
export interface QuickFigureCommitPieces {
  name: string;
  view: PlotView;
  mark: PlotMark;
  errors: ErrorBinding[];
  /** Per-series X (lib/quickFigureSeriesX.ts): the overlay the figure must
   *  bind to instead of `dataset` -- `view`/`errors` are keyed to ITS
   *  channels. null for a shared-X mapping (bind to `dataset` itself). */
  overlay: QuickFigureOverlay | null;
}

/** Translate a Quick Figure Builder style into a `PlotMark` + any per-series
 *  overlay it implies, mirroring `plotSpecFigure.ts`'s `stylesForMark`
 *  convention (plotSpecFigure.ts:40-58):
 *   - "line" -> mark "line", no series overrides.
 *   - "scatter" -> mark "scatter" -- scatter draws points by convention, no
 *     `seriesStyles` patch needed.
 *   - "line-symbol" -> mark "line" + `marker: true` on every plotted series,
 *     the SeriesStyle field the render core reads for point-on-line drawing.
 */
function markAndSeriesStyles(
  style: QuickPlotStyle,
  yKeys: readonly number[],
  baseSeriesStyles: Readonly<Record<number, SeriesStyle>>,
): { mark: PlotMark; seriesStyles: Record<number, SeriesStyle> } {
  if (style === "scatter") return { mark: "scatter", seriesStyles: { ...baseSeriesStyles } };
  if (style === "line-symbol") {
    const seriesStyles = { ...baseSeriesStyles };
    for (const ch of yKeys) seriesStyles[ch] = { ...(seriesStyles[ch] ?? {}), marker: true };
    return { mark: "line", seriesStyles };
  }
  return { mark: "line", seriesStyles: { ...baseSeriesStyles } };
}

/** Pure conversion -- never mutates `dataset` or `mapping`. Callers gate on
 *  `mappingReady(mapping)` themselves (the button, then belt-and-braces the
 *  store action) before calling this.
 *
 *  The Grouping role becomes `view.groupKey` -- the caller MUST also pass it
 *  as `createFigureDocument`'s explicit `groupKey` (bindings-owned: the
 *  document constructor discards the view copy, and `withPlotWindowDocument`
 *  re-projects the window's view from the document). The Label role becomes
 *  `view.annotations` (lib/quickFigureLabels.ts), one Object Manager group
 *  under `labelGroupId` -- the caller mints it unique per figure. */
export function quickFigureCommit(
  dataset: Dataset,
  mapping: QuickFigureMapping,
  style: QuickPlotStyle,
  labelGroupId = "quick-figure-labels",
): QuickFigureCommitPieces {
  const overlay = quickFigureOverlay(dataset.data, mapping);
  const plot = overlay?.mapping ?? mapping;
  const view = defaultPlotView();
  view.xKey = plot.xKey;
  view.yKeys = [...plot.yKeys];
  view.groupKey = plot.groupKey ?? null;
  // Data-anchored, so computed from the SOURCE (each series at its own X):
  // identical coordinates on the overlay, and the source's hidden rows apply.
  view.annotations = quickFigurePointLabels(dataset, mapping, labelGroupId);
  const { mark, seriesStyles } = markAndSeriesStyles(style, plot.yKeys, view.seriesStyles);
  view.seriesStyles = seriesStyles;
  return {
    name: `Quick Figure — ${dataset.name}`,
    view,
    mark,
    errors: [...plot.errorBindings],
    overlay,
  };
}
