// The parameter and result shapes of `usePlotPayload` (components/Stage/usePlotPayload.ts),
// moved out of it verbatim (module-size ceiling). Types only: no runtime code.

import type { HalfLim } from "../../lib/axisLim";
import type { ColorScatterSpec } from "../../lib/colorscatter";
import type { ErrorBinding } from "../../lib/errorRoles";
import type { ErrorSpan } from "../../lib/errorbars";
import type { PlotPayload } from "../../lib/plotdata";
import type { FigureEncoding } from "../../lib/plotEncodingBinding";
import type { RowRange } from "../../lib/rowRange";
import type { AxisScale, BaselineOverlay, Dataset, DefaultTrace, FitOverlay, PeakOverlay, SeriesStyle } from "../../lib/types";

export interface PlotPayloadParams {
  active: Dataset | null | undefined;
  yScale: AxisScale;
  xScale: AxisScale;
  xKey: number | null;
  yKeys: number[] | null;
  /** P1.5 "Group" well channel -- one series per level (plotGroupSplit.ts).
   *  Ignored when `y2Keys` is non-empty (mirrors the backend's own
   *  "grouped + secondary Y axis" incompatibility, figureSpec.ts). */
  groupKey: number | null;
  y2Keys: number[] | null;
  seriesOrder: number[] | null;
  seriesStyles: Record<number, SeriesStyle>;
  seriesLabels: Record<number, string>;
  errKeys: Record<number, number>;
  /** G4 figure-scoped error honesty: the FOCUSED window's document errors
   *  (`FigureDocument.bindings.errors`), threaded in alongside `errKeys` so
   *  `errorSpans` below can prefer them over `active.errorRoles` when they
   *  carry something the legacy `errKeys` projection cannot express (see
   *  `hasRichErrorBindings`). Undefined (every caller that doesn't thread a
   *  document -- background/panel windows) behaves exactly like today: the
   *  dataset's own `errorRoles` decide. */
  documentErrors?: readonly ErrorBinding[];
  /** P1.4: the window document's Color / Symbol / Label picks
   *  (`FigureBindings.encoding`) -- see usePlotEncoding.ts. Undefined = none. */
  encoding?: FigureEncoding;
  hiddenChannels: number[];
  waterfall: number;
  waterfallDx?: number; // Origin's waterfall X step (Stage/useWaterfallX); absent = 0
  rowRange?: RowRange | null; // PlotView.rowRange: rows outside it draw and range nothing (lib/plotRowWindow.ts); absent = every row
  excludedDisplay: "hide" | "grey";
  fitOverlay: FitOverlay | null;
  baselineOverlay: BaselineOverlay | null;
  peakOverlay: PeakOverlay | null;
  derivOverlay: FitOverlay | null;
  selection: { datasetId: string; rows: number[] } | null;
  /** Current line/scatter/step trace mode (PlotViewport's own prop, threaded
   *  here too — P3.4) — Scatter disqualifies a server-decimation request the
   *  same way it disqualifies the client-side path (see plotDecimate.ts's
   *  decimationRequestEligible). Undefined defaults to "Line" (eligible). */
  defaultTrace?: DefaultTrace;
  /** Committed X view limits — the store's `xLim` (P3.4 zoom-refetch
   *  residual). When the currently loaded BASE payload came back
   *  server-decimated, a committed zoom/pan (this changing to a non-null
   *  window) triggers a follow-up windowed re-fetch so the visible range
   *  recovers full local detail instead of showing only the envelope the
   *  full-range decimation kept. `null` (autoscale/reset — also every
   *  pre-existing caller that omits this prop) shows the cached full-range
   *  payload with NO extra fetch; so does a half-open limit (a side on auto). */
  xLim?: HalfLim | null;
}

/** Would ANY overlay/selection/exclusion companion be appended onto the base
 *  fetch by `composeDisplayPayload`? Those are always built at the dataset's
 *  FULL row count, so a server-decimated (reduced) base cannot safely carry
 *  one — `lib/plotdata.ts`'s `alignOverlayY` would otherwise be asked to
 *  align a full-length column onto a sparse row set (see its P3.4 doc). Takes
 *  each input explicitly (rather than the whole params object) so the fetch
 *  effect's dependency array below can list exactly what this reads — every
 *  one of them IS a listed dependency, so toggling an overlay ON while a
 *  decimated payload is showing triggers a fresh, full-resolution fetch
 *  instead of leaving the overlay silently unaligned. */
export interface PlotPayloadResult {
  /** The raw fetched payload (pre-compose) — most consumers want
   *  `displayPayload` instead; kept for anything that needs the un-composed
   *  series (e.g. a future background viewport building its own compose). */
  payload: PlotPayload | null;
  /** The id of the dataset `payload` was FETCHED for — NOT `params.active.id`,
   *  which advances while these rows still belong to the previous dataset (see
   *  `Stage/useLiveSnapshotPublish`, BUG-013 round 3). */
  payloadDatasetId: string | null;
  /** The fully composed, drawable payload — what PlotViewport renders. */
  displayPayload: PlotPayload | null;
  /** Value-channel indices actually plotted, in draw order. */
  plotted: number[];
  /** Per-display-series style overrides, aligned 1:1 with `displayPayload.series`. */
  styleList: (SeriesStyle | undefined)[] | undefined;
  /** Per-display-series legend-rename overrides, aligned 1:1 with `displayPayload.series`. */
  labelList: (string | undefined)[] | undefined;
  /** P1.4: an encoded render's FINISHED legend text (the same list as
   *  `labelList`), for the DOM legend to show over the channel rename; undefined otherwise. */
  legendLabels?: (string | undefined)[];
  /** Error-bar magnitudes keyed by uPlot data-column index (1-based). */
  errorBars: Map<number, (number | null)[]>;
  /** MAIN #36: asymmetric / X error spans from the canonical role bindings. */
  errorSpans: Map<number, ErrorSpan[]>;
  /** Colour-mapped-scatter specs (MAIN #14) keyed by uPlot data-column index. */
  colorByColumns: Map<number, ColorScatterSpec>;
  /** Per-display-series visibility (interactive legend), aligned 1:1 with `displayPayload.series`. */
  hidden: boolean[] | undefined;
}
