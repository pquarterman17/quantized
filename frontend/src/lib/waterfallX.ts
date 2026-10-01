// Waterfall X offset — the CANVAS half (audit "waterfall settings beyond the
// scalar offset"; FIGURE_AUTHORING_WORKFLOW_PLAN F4.2b). Origin's waterfall
// has an X offset as well as a Y one: series s slides right by s·dx, with dx
// a fraction of the x-span (`PlotView.waterfallDx`), the same units the Y half
// (`view.waterfall`, `lib/waterfallOffset.ts`) uses for the y-span.
//
// WHY A SEGMENT-CONCATENATED LAYOUT. uPlot draws every series against ONE x
// column, so a per-series x cannot be a shifted copy of it. The payload is
// laid out the way the app already draws a multi-X worksheet
// (`lib/originOverlay.ts`, `lib/quickFigureSeriesX.ts`): one x BLOCK per
// display slot holding `x + slot·step`, each column's values inside its own
// slot's block and null in every other, so a line breaks between blocks. The
// export lays its series out the same way (`calc.plot_waterfall_x`), from the
// offsets `waterfallWire` resolves — so screen and export draw the same points
// per series (`tests/fixtures/wire/waterfall_x_offset.json`).
//
// WHEN. Applied LAST, after `plotdata.composeDisplayPayload` (y offset → mask
// → overlays → selection), because every earlier layer is index-aligned to the
// dataset's rows; expanding first would misalign all of them. The slot of a
// companion column is read back off the compose order, which is fixed: the
// `base` value columns, then a greyed ghost per base column (`muted`), then
// overlays (fit/baseline/peaks/dy-dx — slot 0, unshifted, exactly as the Y
// offset leaves them), then a selection mark per preceding column
// (`selected`). Row-aligned companions keyed by display column (error bars,
// error spans, colour-by) are moved into the same blocks here too, and
// `blockRows` lets the brush map a block row back to its dataset row
// (`waterfallOffset.waterfallSourceRows`).
//
// LAZY. Only `Stage/useWaterfallX` imports this, dynamically and only once a
// non-zero step is set — no eager cost for a plot that never uses it.

import type uPlot from "uplot";

import type { ColorScatterSpec } from "./colorscatter";
import type { ErrorSpan } from "./errorbars";
import type { PlotPayload, PlotSeriesSpec } from "./plotdata";
import { waterfallSpan, waterfallXApplies } from "./waterfallOffset";

type Col = (number | null)[];

export interface WaterfallXCompanions {
  errorBars: Map<number, Col>;
  errorSpans: Map<number, ErrorSpan[]>;
  colorByColumns: Map<number, ColorScatterSpec>;
}

/** The display slot of every value column (index 0 = data column 1). */
function slotsOf(series: readonly PlotSeriesSpec[], base: number): number[] {
  const firstMark = series.findIndex((s) => s.selected);
  const out: number[] = [];
  series.forEach((s, i) => {
    if (i < base) out.push(i);
    else if (s.selected && firstMark >= 0) out.push(out[i - firstMark] ?? 0);
    else out.push(s.muted && i < 2 * base ? i - base : 0);
  });
  return out;
}

/** `col` (row-aligned, `rows` long) inside block `slot` of `blocks` blocks. */
function place<T>(col: readonly T[], slot: number, rows: number, blocks: number): (T | null)[] {
  const out: (T | null)[] = new Array<T | null>(rows * blocks).fill(null);
  for (let r = 0; r < rows && r < col.length; r++) out[slot * rows + r] = col[r];
  return out;
}

/** Expand a COMPOSED display payload (and its row-aligned companions) into the
 *  per-slot x blocks. `base` is the number of plotted series before compose;
 *  `fraction` the view's `waterfallDx`. Identity (the same objects) when the
 *  step is off or there is nothing to stagger against. */
export function expandWaterfallX(
  payload: PlotPayload,
  base: number,
  fraction: number,
  companions: WaterfallXCompanions,
): WaterfallXCompanions & { displayPayload: PlotPayload } {
  const [x, ...ys] = payload.data as unknown as Col[];
  const step = fraction * waterfallSpan([x]);
  if (!waterfallXApplies(fraction) || base < 2 || !step) return { displayPayload: payload, ...companions };
  const rows = x.length;
  const slots = slotsOf(payload.series, base);
  const xs: Col = [];
  for (let b = 0; b < base; b++) for (const v of x) xs.push(v == null ? v : v + b * step);
  const at = <T>(col: readonly T[], key: number) => place(col, slots[key - 1] ?? 0, rows, base);
  const errorBars = new Map([...companions.errorBars].map(([k, col]): [number, Col] => [k, at(col, k)]));
  const errorSpans = new Map(
    [...companions.errorSpans].map(([k, spans]): [number, ErrorSpan[]] => [
      k,
      spans.map((s) => ({ ...s, plus: at(s.plus, k), minus: at(s.minus, k) })),
    ]),
  );
  const colorByColumns = new Map(
    [...companions.colorByColumns].map(([k, spec]): [number, ColorScatterSpec] => [k, { ...spec, z: at(spec.z, k) }]),
  );
  const data = [xs, ...ys.map((col, i) => at(col, i + 1))] as unknown as uPlot.AlignedData;
  return { displayPayload: { ...payload, data, blockRows: rows }, errorBars, errorSpans, colorByColumns };
}
