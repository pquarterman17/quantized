// Commit for the curve-measurement gadget kinds (intersect, level crossings,
// rise time): the same worksheet the "Curve measurements" panel adds (one row
// per crossing, or the two reference crossings of a step), through the same
// producer and settings, so it is one undo step, a repeat click finds the
// existing output, the output goes out of date when its source changes, and
// "Open in Curve measurements" reopens it. The source rows are recorded by the
// shared contract from the region (`xWindow`): how many rows of the analysis
// view fell inside it, and the X range they span.

import { analysisDataFingerprint } from "../../lib/analysisResultFreshness";
import type { GadgetMeasure } from "../../lib/gadgetMeasure";
import type { Dataset } from "../../lib/types";
import { commitComputedOutput } from "../../store/commitComputedOutput";
import { toast } from "../../store/toasts";
import { measureDigest, measureOutput } from "../workshops/curvemeasure/curveMeasureOutput";
import type { MeasureResult } from "../workshops/curvemeasure/curveMeasureRun";
import { CURVE_MEASURE_PRODUCER } from "../workshops/curvemeasure/useCurveMeasure";

type Measured = Exclude<GadgetMeasure, { mode: "interpolate" }>;

/** The panel's result for a gadget measurement. */
export function panelResultOf(m: Measured): MeasureResult {
  if (m.mode === "intersect") return { mode: "intersect", r: m.r };
  return m.mode === "levelcrossing" ? { mode: "level", r: m.r } : { mode: "step", r: m.r };
}

/** Rows a commit would write (0 = nothing to add). */
export function measuredRows(m: Measured): number {
  if (m.mode === "intersect") return m.r.intersections.length;
  return m.mode === "levelcrossing" ? m.r.crossings.length : 2;
}

/** What the chip hands over: the measurement shown, the worksheets, and the status line. */
export interface MeasureCommitContext {
  m: Measured;
  activeId: string | null;
  datasets: readonly Dataset[];
  setStatus: (text: string, tone: "danger") => void;
}

export function commitGadgetMeasure({ m, activeId, datasets, setStatus }: MeasureCommitContext): void {
  const fail = (why: string): void => {
    setStatus(why, "danger");
    toast(why, "danger");
  };
  const src = m.source;
  const active = datasets.find((d) => d.id === src.id);
  if (!active || activeId !== src.id) return fail("Gadget measurement: this result was not computed on the active worksheet; move the region to measure again");
  if (measuredRows(m) === 0) return fail("Gadget measurement: there is nothing to add, no positions were found");
  const other = src.bSheet === null ? null : (datasets.find((d) => d.id === src.bSheet) ?? null);
  if (src.bSheet !== null && !other) return fail("Gadget measurement: the second curve's worksheet is no longer available");
  const result = panelResultOf(m);
  const lb = {
    xLabel: src.a.xKey === null ? String(active.data.metadata?.x_column_name ?? "") : (active.data.labels[src.a.xKey] ?? ""),
    xUnit: m.units.x,
    yLabel: active.data.labels[src.a.yKey] ?? "",
    yUnit: m.units.y,
  };
  const out = measureOutput(result, lb);
  const panelMode = result.mode;
  const settings: Record<string, unknown> = {
    mode: panelMode, level: "", hysteresis: "", direction: "both", lowPct: "10", highPct: "90", edge: "auto", lowLevel: "", highLevel: "",
    xCol: src.a.xKey ?? -1, yCol: src.a.yKey, bOther: !!other, bX: src.b ? (src.b.xKey ?? -1) : -1, bY: src.b?.yKey ?? -1,
  };
  if (m.mode === "levelcrossing") {
    Object.assign(settings, { level: String(m.r.level), hysteresis: String(m.r.hysteresis) });
  } else if (m.mode === "risetime") {
    Object.assign(settings, {
      plateauMethod: m.r.plateau_method, lowPct: String(m.r.low_fraction * 100), highPct: String(m.r.high_fraction * 100), edge: m.r.edge,
      lowLevel: m.r.plateaus_estimated[0] ? "" : String(m.r.low_plateau), highLevel: m.r.plateaus_estimated[1] ? "" : String(m.r.high_plateau),
    });
  }
  const sources = [{ id: active.id, computedOn: src.computedOn }];
  if (other) sources.push({ id: other.id, computedOn: analysisDataFingerprint(other) });
  const outcome = commitComputedOutput({
    producer: CURVE_MEASURE_PRODUCER,
    sources,
    settings: { ...settings, ...measureDigest(result), roi: [...src.roi], from: "gadget" },
    name: `${active.name} (${out.suffix})`,
    data: out.data,
    xKey: other ? { [active.id]: src.a.xKey, [other.id]: src.b?.xKey ?? null } : src.a.xKey,
    xWindow: [Math.min(src.roi[0], src.roi[1]), Math.max(src.roi[0], src.roi[1])],
    status: `added the ${panelMode === "intersect" ? "intersections" : panelMode === "level" ? "level crossings" : "step times"}`,
  });
  if (outcome.kind === "created" || outcome.kind === "replaced") toast("Measurement added to library", "ok");
}
