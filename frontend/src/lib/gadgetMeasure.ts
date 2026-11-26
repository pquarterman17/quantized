// The curve-measurement ROI gadget kinds (plan item 2): intersect, interpolate
// and rise time. Pure helpers for the lazy compute body (store/gadgetRun.ts);
// the numbers come from the curve-measure calc (`/api/curve-measure`, the same
// calls the "Curve measurements" panel makes) and, for interpolate, the
// worksheet formula language's `interp()` (lib/formulaMath, numpy.interp), so
// no measurement math lives here. Loaded only with the gadget compute chunk.

import type { IntersectResult, StepTimeResult } from "./api/curveMeasure";
import { interpAt, interpTable } from "./formulaMath";
import { ownXKey } from "./perSeriesX";
import { effectiveChannels } from "./plotdata";
import { gadgetCurve, selectRoiRows } from "./quickfit";
import type { Dataset, OverlayBinding } from "./types";

/** What the chip shows for the three measurement modes. */
export type GadgetMeasure =
  | { mode: "intersect"; r: IntersectResult; bKey: number }
  | { mode: "risetime"; r: StepTimeResult }
  | { mode: "interpolate"; at: [number, number]; rows: { yKey: number; y: [number | null, number | null] }[] };

type View = Parameters<typeof gadgetCurve>[1];

/** The rise-time request the panel makes with its untouched settings
 *  (10 % / 90 %, edge detected, plateaus estimated): the gadget has no settings
 *  of its own, so it must send exactly this. */
export const GADGET_STEP_BODY = { low_fraction: 0.1, high_fraction: 0.9, edge: "auto" } as const;

/** Curve B for an intersection: the picked channel when it is a real channel other
 *  than curve A, else the next visible plotted curve. Each is on its OWN X. */
export function curveBFor(ds: Dataset, view: View, a: OverlayBinding, pick: number | null): OverlayBinding | null {
  const own = (yKey: number): OverlayBinding => ({ yKey, xKey: ownXKey(ds, view.xKey, yKey) });
  if (pick !== null && pick !== a.yKey && pick >= 0 && pick < ds.data.labels.length) return own(pick);
  const plotted = effectiveChannels(ds.data, view.yKeys, view.xKey, ds.channelRoles, view.seriesOrder);
  const next = plotted.find((c) => c !== a.yKey && !view.hiddenChannels.includes(c));
  return next === undefined ? null : own(next);
}

/** The curve as drawn (X ascending, repeated X averaged, like the calc's own
 *  preparation), as an `interp()` table; null with fewer than two distinct X. */
function curveTable(x: readonly number[], y: readonly number[]) {
  const order = x.map((_, i) => i).sort((p, q) => x[p]! - x[q]!);
  const xs: number[] = [];
  const ys: number[] = [];
  let run = 0;
  for (const i of order) {
    if (xs.length > 0 && xs[xs.length - 1] === x[i]) {
      ys[ys.length - 1] = ys[ys.length - 1]! + (y[i]! - ys[ys.length - 1]!) / ++run;
    } else {
      xs.push(x[i]!);
      ys.push(y[i]!);
      run = 1;
    }
  }
  return xs.length < 2 ? null : interpTable(xs, ys, "X");
}

/** The interpolated Y of every visible plotted curve at each cursor X (null
 *  outside the curve's X range, where nothing is drawn). */
export function interpolateRows(ds: Dataset, view: View, at: readonly [number, number]): Extract<GadgetMeasure, { mode: "interpolate" }>["rows"] {
  const plotted = effectiveChannels(ds.data, view.yKeys, view.xKey, ds.channelRoles, view.seriesOrder);
  return plotted
    .filter((c) => !view.hiddenChannels.includes(c))
    .map((yKey) => {
      const sel = selectRoiRows(ds, [-Infinity, Infinity], yKey, ownXKey(ds, view.xKey, yKey));
      const t = curveTable(sel.x, sel.y);
      const at1 = (v: number): number | null => {
        const r = t ? interpAt(t, v) : NaN;
        return Number.isFinite(r) ? r : null;
      };
      return { yKey, y: [at1(at[0]), at1(at[1])] as [number | null, number | null] };
    });
}
