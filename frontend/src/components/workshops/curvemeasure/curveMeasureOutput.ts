// What a committed curve measurement writes: a small worksheet of the measured
// positions (one row per crossing, or the two reference crossings of a step)
// with the headline numbers in its metadata, plus a short digest recorded with
// the result. Pure; the hook supplies the labels and units of the source.

import type { DataStruct } from "../../../lib/types";
import type { MeasureResult } from "./curveMeasureRun";

export interface MeasureLabels {
  xLabel: string;
  xUnit: string;
  yLabel: string;
  yUnit: string;
}

const DIRECTION_CODE = { rising: 1, falling: -1 } as const;
const DIRECTION_LABEL = "Direction (+1 rising, -1 falling, 0 none)";

/** Rows the result would write; 0 means there is nothing to commit. */
export function measureRows(m: MeasureResult): number {
  if (m.mode === "intersect") return m.r.intersections.length;
  return m.mode === "level" ? m.r.crossings.length : 2;
}

/** Short summary recorded beside the settings (numbers only, no arrays). */
export function measureDigest(m: MeasureResult): Record<string, number | string> {
  if (m.mode === "intersect") return { n: m.r.intersections.length, xMin: m.r.x_min, xMax: m.r.x_max };
  if (m.mode === "level") return { n: m.r.crossings.length, level: m.r.level };
  return { edge: m.r.edge, time: m.r.time, xLow: m.r.x_low, xHigh: m.r.x_high };
}

export function measureOutput(m: MeasureResult, lb: MeasureLabels): { suffix: string; data: DataStruct } {
  const base = { x_column_name: lb.xLabel || "x", x_column_unit: lb.xUnit };
  if (m.mode === "intersect") {
    const rows = m.r.intersections;
    return {
      suffix: "intersections",
      data: {
        time: rows.map((p) => p.x),
        values: rows.map((p) => [p.y, p.direction ? DIRECTION_CODE[p.direction] : 0]),
        labels: [lb.yLabel || "y", DIRECTION_LABEL],
        units: [lb.yUnit, ""],
        metadata: { ...base, curve_measure: { kind: "intersect", x_min: m.r.x_min, x_max: m.r.x_max, n: rows.length } },
      },
    };
  }
  if (m.mode === "level") {
    const rows = m.r.crossings;
    return {
      suffix: "level crossings",
      data: {
        time: rows.map((c) => c.x),
        values: rows.map((c) => [m.r.level, DIRECTION_CODE[c.direction]]),
        labels: [lb.yLabel || "y", DIRECTION_LABEL],
        units: [lb.yUnit, ""],
        metadata: { ...base, curve_measure: { kind: "level", level: m.r.level, hysteresis: m.r.hysteresis, n: rows.length } },
      },
    };
  }
  const r = m.r;
  // Rows run in ascending X, so a fall lists its high-level crossing first.
  const steps = r.x_low <= r.x_high
    ? [{ x: r.x_low, level: r.low_level }, { x: r.x_high, level: r.high_level }]
    : [{ x: r.x_high, level: r.high_level }, { x: r.x_low, level: r.low_level }];
  return {
    suffix: `${r.edge} time`,
    data: {
      time: steps.map((p) => p.x),
      values: steps.map((p) => [p.level]),
      labels: [lb.yLabel || "y"],
      units: [lb.yUnit],
      metadata: {
        ...base,
        curve_measure: {
          kind: "step", edge: r.edge, time: r.time, low_fraction: r.low_fraction, high_fraction: r.high_fraction,
          low_plateau: r.low_plateau, high_plateau: r.high_plateau, plateaus_estimated: [...r.plateaus_estimated],
        },
      },
    },
  };
}
