// The Lasso Mask tool's commit (gap audit 4 G19): the rows a released lasso
// encloses (`lib/plotPointMask.lassoRows`, traced through the payload's row
// map on a reduced plot, refused when that cannot be done exactly) become
// masked -- or, with Shift, unmasked -- in ONE `setRowsExcluded`, so one undo
// step. Loaded on demand from `Stage/usePlotStageActions.ts`.

import type uPlot from "uplot";

import { toast } from "../store/toasts";
import { useApp } from "../store/useApp";
import type { PlotPayload } from "./plotdata";
import { lassoRows, type Polygon } from "./plotPointMask";
import { excludedSet } from "./rowstate";
import type { Dataset } from "./types";

/** Mask (or unmask) what `poly` (css px over `u`'s plotting area) encloses. */
export function lassoMask(u: uPlot, payload: PlotPayload, plotted: readonly number[], ds: Dataset, poly: Polygon, unmask: boolean): void {
  const toPx = (x: number, y: number, axis: 0 | 1): [number, number] => [u.valToPos(x, "x"), u.valToPos(y, axis === 1 ? "y2" : "y")];
  const got = lassoRows(payload, plotted, ds, useApp.getState().xKey, poly, toPx);
  if ("refused" in got) {
    toast(`couldn't mask those points: ${got.refused}`, "danger");
    return;
  }
  const excluded = excludedSet(ds);
  const changed = got.rows.filter((r) => excluded.has(r) === unmask);
  if (changed.length === 0) {
    toast(got.rows.length ? `those points are already ${unmask ? "unmasked" : "masked"}` : "no points inside the lasso", "ok");
    return;
  }
  const hit = new Set(got.rows);
  const next = unmask ? [...excluded].filter((r) => !hit.has(r)) : [...excluded, ...changed];
  useApp.getState().setRowsExcluded(ds.id, next.sort((a, b) => a - b));
  toast(`${unmask ? "unmasked" : "masked"} ${changed.length} point${changed.length === 1 ? "" : "s"} (undo restores them)`, "ok");
}
