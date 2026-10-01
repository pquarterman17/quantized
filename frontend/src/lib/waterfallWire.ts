// The EXPORT half of the waterfall: the per-series offsets a `FigureSpec`
// carries (`waterfall_offsets`, and Origin's X step as `waterfall_x_offsets`),
// resolved from the SAME span rule the canvas staggers by. The why — resolved
// offsets rather than the raw fraction, which rows the span is measured over,
// the live-canvas span and the no-live-canvas fallback — is
// `lib/waterfallOffset.ts`'s header; this module is only the builder.
//
// Split out of waterfallOffset.ts (the X-offset change, eager-bytes budget):
// that module is reached eagerly through the canvas (`plotdata`, the live-span
// seam), while the only caller of this builder is `lib/figureSpec.ts`, which
// is loaded with the export — so the builder no longer rides the first paint.

import { buildColumns, dropTrailingEmptyRows } from "./plotdata";
import { overlayModesMatchTheCanvas, type CycleView } from "./seriesStyleCycle";
import type { DataStruct } from "./types";
import { waterfallApplies, waterfallSpan, waterfallXApplies } from "./waterfallOffset";

/** The value columns a canvas with no live payload behind it would draw, built
 *  exactly the way `plotdata.fetchPlot`'s offline path builds them: pack the
 *  canvas' channels against this request's x channel, then drop the trailing
 *  empty/over-allocated rows every fetched payload has already had dropped. The
 *  span the wire falls back to is measured over THESE columns — see
 *  `lib/waterfallOffset.ts`'s header for the two divergences that reading
 *  `data.values` directly produced. Returned as `[x, ...values]`: the x
 *  column is what the X step's fallback span is measured over. */
function canvasColumns(
  data: DataStruct,
  channels: readonly number[],
  xKey: number | null,
): (number | null)[][] {
  const packed = dropTrailingEmptyRows(buildColumns(data, null, xKey, [...channels]));
  return packed.data as unknown as (number | null)[][];
}

/** The `waterfall_offsets` half of a `FigureSpec` (plus `waterfall_x_offsets`,
 *  Origin's X step, in x data units at the same slots), or `{}` when the view
 *  has no waterfall (so an ordinary export's wire is byte-identical to before).
 *
 *  `canvasChannels` is the CANVAS' display list (`lib/figureSpecSeries.
 *  resolveDisplaySeries`) — the index space `positions` are slots in, so a
 *  hidden series reserves its stagger step exactly as it does on screen — and
 *  the list the fallback span is measured over. Every plotted series is offset,
 *  secondary-axis ones included: `applyWaterfall` shifts every value column of
 *  the payload, and the y2 columns are in it.
 *
 *  REFUSED for every view whose canvas is not the plain single-panel XY overlay
 *  this field is keyed to, through the SAME predicate the canvases and the
 *  series-style cycle ask (`seriesStyleCycle.overlayModesMatchTheCanvas`):
 *  a `group_col` split and a resolved `facets` grid, whose renderers cannot
 *  align a list keyed by `y_keys` at all (the backend expands each channel into
 *  one synthetic series per level; the facet branch renders from its own panel
 *  payloads) — and `stackMode`/`polarMode`/`statMode`, where the XY canvas is
 *  replaced outright and NOTHING is staggered on screen, so emitting offsets
 *  staggered an export the user's screen never did. Omitting the field is the
 *  honest response: the renderer never receives an offset it would mis-apply.
 *
 *  The GROUP clause of that predicate is asked about the grouping this request
 *  actually carries, not the view's raw binding (BUG-013 round 3). `groupCol`
 *  is REQUIRED and carries that answer directly — the exact value
 *  `figureSpec.ts` already resolved with `plotGroupSplit.canvasGroupCol`
 *  (the same rule `Stage/usePlotPayload` applies to decide what to draw;
 *  NIT 9 deleted the one-line `figureSpecGroup.resolveGroupCol` alias that
 *  used to sit between them) and put on the wire as `group_col`. Round 4
 *  had this fall back to a SECOND `canvasGroupCol` call over the view's raw
 *  binding whenever `groupCol` was `null` — indistinguishable from "not
 *  resolved yet" — so a route that resolved `group_col` to null (an explicit
 *  degrade) and a route that never resolved anything at all read the SAME
 *  `null` and disagreed on what it meant: on the live `buildFigureSpec` route,
 *  `group_col` came out absent while the fallback still read the view's own
 *  `groupKey` and refused the offsets. One required argument, no fallback,
 *  removes the second reading entirely.
 *
 *  `span` is the canvas' own measured y-range when a live XY canvas published
 *  one for this request (see `readLiveWaterfallSpan`); absent, see the
 *  no-live-canvas fallback in this module's header. */
export function waterfallWire(args: {
  data: DataStruct;
  canvasChannels: readonly number[];
  positions: readonly number[];
  fraction: number;
  view: CycleView;
  span?: number | null;
  /** The X half (Origin's waterfall X step): `view.waterfallDx`, and the live
   *  canvas' x-span when one was published (`readLiveWaterfallSpan(id, "xSpan")`) — absent,
   *  the x column of the same fallback columns the y-span uses. */
  xFraction?: number;
  xSpan?: number | null;
  /** The `group_col` this spec emits — `null` means the request draws a plain
   *  ungrouped overlay whatever the view binds. REQUIRED, and the caller's
   *  ONLY resolution of it: see this function's doc for why a fallback here
   *  read a second, possibly-disagreeing answer. */
  groupCol: number | null;
}): { waterfall_offsets?: number[]; waterfall_x_offsets?: number[] } {
  const y = waterfallApplies(args.fraction);
  const xFraction = args.xFraction ?? 0;
  const x = waterfallXApplies(xFraction);
  // `< 2` mirrors `applyWaterfall`'s `payload.data.length <= 2` (x + one value
  // column): a single series has nothing to be staggered against. Asked about
  // the CANVAS' list, because that is what `applyWaterfall` counts — an X-as-Y
  // request can carry two display channels while the canvas draws one curve.
  if ((!y && !x) || args.canvasChannels.length < 2) return {};
  if (!overlayModesMatchTheCanvas({ ...args.view, groupKey: args.groupCol })) return {};
  let packed: (number | null)[][] | null = null;
  const cols = () => (packed ??= canvasColumns(args.data, args.canvasChannels, args.view.xKey));
  const given = (v: number | null | undefined) => (v != null && Number.isFinite(v) ? v : null);
  const step = y ? args.fraction * (given(args.span) ?? waterfallSpan(cols().slice(1))) : 0;
  const xStep = x ? xFraction * (given(args.xSpan) ?? waterfallSpan(cols().slice(0, 1))) : 0;
  // A zero step (an all-equal column set at a vanishing fraction) is no
  // stagger at all. An overflow to Infinity needs no guard here: the backend
  // skips any non-finite offset (`calc.plotting.apply_waterfall_offsets`,
  // `calc.plot_waterfall_x`).
  return {
    ...(step ? { waterfall_offsets: args.positions.map((p) => p * step) } : {}),
    ...(xStep ? { waterfall_x_offsets: args.positions.map((p) => p * xStep) } : {}),
  };
}
