// Pure helpers for the prediction / contour profiler (GAP_AUDIT_9 G7): trace
// geometry, contour lines and limit shading. No React, no fetch.

import type { ProfilerModel, ProfilerSettings } from "./api/modelEvaluate";

export interface ProfilerFactor {
  name: string;
  kind: "continuous" | "nominal";
  levels: string[];
  /** continuous: the fitted range; null when the model does not store one. */
  range: [number, number] | null;
  mean: number;
}

/** The factors a model's terms use, in model order. */
export function profilerFactors(model: ProfilerModel): ProfilerFactor[] {
  const used = new Set(model.terms.flat());
  return model.factors.filter((f) => used.has(f.name)).map((f) => (
    f.kind === "nominal"
      ? { name: f.name, kind: "nominal" as const, levels: f.levels, range: null, mean: 0 }
      : { name: f.name, kind: "continuous" as const, levels: [], range: model.ranges?.[f.name] ?? null, mean: f.mean }
  ));
}

/** Why the model cannot be profiled, or null. */
export function profilerProblem(model: ProfilerModel): string | null {
  const factors = profilerFactors(model);
  if (!factors.length) return "this model has no factors to profile";
  const noRange = factors.find((f) => f.kind === "continuous" && !f.range);
  return noRange
    ? `no fitted range is stored for ${noRange.name}; run Fit Model again (older saved results predate the profiler)`
    : null;
}

/** JMP's starting point: continuous at the fitted mean, nominal averaged. */
export function defaultSettings(model: ProfilerModel): ProfilerSettings {
  const out: ProfilerSettings = {};
  for (const f of profilerFactors(model)) out[f.name] = f.kind === "continuous" ? f.mean : null;
  return out;
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Slider step for a range: 1/200 of it, rounded to one significant digit. */
export function sliderStep(lo: number, hi: number): number {
  const raw = (hi - lo) / 200;
  if (!(raw > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return Math.round(raw / mag) * mag || raw;
}

export interface Segment { x1: number; y1: number; x2: number; y2: number }

/** Marching squares: line segments of z = level over a rectilinear grid
 *  (z[j][i] at x[i], y[j]), in data coordinates. Saddles resolve by the cell
 *  centre. */
export function contourSegments(x: readonly number[], y: readonly number[], z: readonly (readonly number[])[], level: number): Segment[] {
  const out: Segment[] = [];
  const at = (a: number, b: number, za: number, zb: number): number => (zb === za ? 0.5 : (level - za) / (zb - za)) * (b - a) + a;
  for (let j = 0; j + 1 < y.length; j++) {
    for (let i = 0; i + 1 < x.length; i++) {
      const z00 = z[j]![i]!, z10 = z[j]![i + 1]!, z01 = z[j + 1]![i]!, z11 = z[j + 1]![i + 1]!;
      const code = (z00 > level ? 1 : 0) | (z10 > level ? 2 : 0) | (z11 > level ? 4 : 0) | (z01 > level ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const x0 = x[i]!, x1 = x[i + 1]!, y0 = y[j]!, y1 = y[j + 1]!;
      const bottom = { x: at(x0, x1, z00, z10), y: y0 };
      const right = { x: x1, y: at(y0, y1, z10, z11) };
      const top = { x: at(x0, x1, z01, z11), y: y1 };
      const left = { x: x0, y: at(y0, y1, z00, z01) };
      const seg = (p: { x: number; y: number }, q: { x: number; y: number }) => out.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y });
      const centreAbove = (z00 + z10 + z01 + z11) / 4 > level;
      switch (code) {
        case 1: case 14: seg(left, bottom); break;
        case 2: case 13: seg(bottom, right); break;
        case 3: case 12: seg(left, right); break;
        case 4: case 11: seg(right, top); break;
        case 6: case 9: seg(bottom, top); break;
        case 7: case 8: seg(left, top); break;
        case 5: if (centreAbove) { seg(left, top); seg(bottom, right); } else { seg(left, bottom); seg(right, top); } break;
        case 10: if (centreAbove) { seg(left, bottom); seg(right, top); } else { seg(left, top); seg(bottom, right); } break;
      }
    }
  }
  return out;
}

/** Evenly spaced "nice-ish" contour levels strictly inside (min, max). */
export function contourLevels(z: readonly (readonly number[])[], count = 7): number[] {
  let lo = Infinity, hi = -Infinity;
  for (const row of z) for (const v of row) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!(hi > lo)) return [];
  return Array.from({ length: count }, (_, k) => lo + ((k + 1) / (count + 1)) * (hi - lo));
}

/** True where the predicted value violates the user's response limits. */
export function outsideLimits(v: number, lower: number | null, upper: number | null): boolean {
  return (lower !== null && v < lower) || (upper !== null && v > upper);
}
