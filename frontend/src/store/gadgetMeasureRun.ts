// The curve-measurement ROI gadget compute (intersect, level crossings, rise
// time over the ROI band; interpolate at the cursors), split out of
// store/gadgetRun.ts. Lazy like it: nothing eager may import this statically.
// The requests are the "Curve measurements" panel's, over the ROI band's rows;
// each result is stamped with its units and the source it was computed on
// (the worksheet, its fingerprint, the region, the source rows) for Commit.

import { analysisDataFingerprint } from "../lib/analysisResultFreshness";
import { measureIntersect, measureLevelCrossings, measureStepTime } from "../lib/api/curveMeasure";
import {
  curveBFor, interpolateRows, sourceRowSpan, unitOfColumn, type GadgetMeasure, type MeasureSource,
} from "../lib/gadgetMeasure";
import { levelBodyFor, stepBodyFor } from "../lib/gadgetMeasureOptions";
import { gadgetCurve, selectRoiRows } from "../lib/quickfit";
import { useGadgetMeasureOptions } from "./gadgetMeasureOptions";
import type { GadgetRunCtx } from "./gadgetRun";
import type { AppState } from "./useApp";

/** One async region-mode request (gadgetRun's `runRegion`). */
export type RunRegion = <T>(
  activeId: string, call: () => Promise<T>, apply: (r: T) => Partial<AppState>, what: string,
) => Promise<void>;

export function createMeasureRun({ set, get }: Pick<GadgetRunCtx, "set" | "get">, runRegion: RunRegion) {
  return async (): Promise<void> => {
    const s = get();
    const active = s.datasets.find((d) => d.id === s.activeId) ?? null;
    const mode = s.gadgetMode;
    if (mode === "interpolate") {
      if (!active || !s.gadgetCursors) return set({ gadgetMeasure: null });
      return set({ gadgetMeasure: { mode, at: s.gadgetCursors, rows: interpolateRows(active, s, s.gadgetCursors) } });
    }
    if (!active || !s.qfitRoi) return set({ gadgetBusy: false }); // nothing to compute: never stuck busy
    const a = gadgetCurve(active, s);
    const roi: [number, number] = [s.qfitRoi[0], s.qfitRoi[1]];
    const none = (error: string) => set({ gadgetError: error, gadgetBusy: false, gadgetMeasure: null });
    if (!a) return none("no curve is plotted");
    const opts = useGadgetMeasureOptions.getState().options;
    const selA = selectRoiRows(active, roi, a.yKey, a.xKey);
    const stamp = (b: MeasureSource["b"], bSheet: string | null, yB: string) => ({
      units: { x: unitOfColumn(active, a.xKey), y: unitOfColumn(active, null, a.yKey), yB },
      source: { id: active.id, computedOn: analysisDataFingerprint(active), roi, a, b, bSheet, rows: sourceRowSpan(selA.rows) },
    });
    if (mode === "risetime") {
      if (selA.x.length < 5) return none("need at least 5 points in the selected region");
      const req = stepBodyFor(opts, selA.x, selA.y);
      if (!req.ok) return none(req.error);
      const st = stamp(null, null, "");
      return runRegion(active.id, () => measureStepTime(req.body), (r): Partial<AppState> => ({ gadgetMeasure: { mode: "risetime", r, ...st } }), "rise time");
    }
    if (mode === "levelcrossing") {
      if (selA.x.length < 2) return none("not enough points in the selected region");
      const req = levelBodyFor(opts, selA.x, selA.y);
      if (!req.ok) return none(req.error);
      const st = stamp(null, null, "");
      return runRegion(active.id, () => measureLevelCrossings(req.body), (r): Partial<AppState> => ({ gadgetMeasure: { mode: "levelcrossing", r, auto: !!req.auto, ...st } as GadgetMeasure }), "level crossings");
    }
    const other = opts.curveBSheet === null ? null : (s.datasets.find((d) => d.id === opts.curveBSheet) ?? null);
    if (opts.curveBSheet !== null && (!other || other.pending)) return none("the second curve's worksheet is not available");
    const b = curveBFor(active, s, a, s.gadgetCurveB, other);
    if (!b) return none("plot or pick a second curve to intersect with");
    const bDs = other ?? active;
    const selB = selectRoiRows(bDs, roi, b.yKey, b.xKey);
    if (selA.x.length < 2 || selB.x.length < 2) return none("not enough points in the selected region");
    const st = stamp(b, other?.id ?? null, unitOfColumn(bDs, null, b.yKey));
    await runRegion(
      active.id,
      () => measureIntersect({ x1: selA.x, y1: selA.y, x2: selB.x, y2: selB.y }),
      (r): Partial<AppState> => ({ gadgetMeasure: { mode: "intersect", r, bKey: b.yKey, ...st } }),
      "intersect",
    );
  };
}
