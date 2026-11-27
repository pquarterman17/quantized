// The Pick tool's click (gap plan item 22): the data point nearest to a click,
// collected into the Pick list (store/pickedPoints.ts). Loaded on demand from
// Stage/usePlotStageActions.ts (`onPick`): the Pick plugin hands its click over
// on its own channel, apart from the lasso's outline.

import type uPlot from "uplot";

import { toast } from "../store/toasts";
import { usePickedPoints } from "../store/pickedPoints";
import { useApp } from "../store/useApp";
import type { PlotPayload } from "./plotdata";
import { nearestDrawn, traceRow } from "./plotPointMask";
import { resolvePick } from "./pickPoints";
import type { Dataset } from "./types";

/** A click this close (css px) to a data point picks it. */
export const PICK_PX = 14;

export function pickAt(u: uPlot, payload: PlotPayload, plotted: readonly number[], ds: Dataset, at: readonly [number, number]): void {
  const s = useApp.getState();
  const hit = nearestDrawn(u, at[0], at[1], payload, plotted, PICK_PX);
  if (!hit) return void s.setStatus("Pick: no data point near that click");
  const traced = traceRow(payload, hit.row, plotted, ds, s.xKey);
  if ("refused" in traced) return void toast(`couldn't pick that point: ${traced.refused}`, "danger");
  // A masked point is drawn as a second, muted set of series after the data ones.
  const channel = plotted[hit.series % plotted.length];
  const p = resolvePick(s, ds, channel, traced.row);
  if ("refused" in p) return void toast(`couldn't pick that point: ${p.refused}`, "danger");
  const [mx, my] = [payload.data[0]?.[hit.row], payload.data[hit.series + 1]?.[hit.row]];
  if (typeof mx === "number" && typeof my === "number") p.mark = { graphId: ds.id, x: mx, y: my, scale: u.series[hit.series + 1]?.scale ?? "y" };
  const n = usePickedPoints.getState().points.length;
  const added = usePickedPoints.getState().add(p);
  // The click snaps to the nearest of ALL plotted curves: name the one it landed on.
  const from = `${p.yLabel} of ${p.datasetName}${plotted.length > 1 ? `, the nearest of ${plotted.length} plotted curves` : ""}`;
  s.setStatus(added ? `picked point ${n + 1} from ${from}: ${p.xLabel} = ${p.x}, ${p.yLabel} = ${p.y}` : "Pick: that point is already picked");
}
