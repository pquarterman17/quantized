// /api/magnetometry/* wrappers — split out of lib/api.ts (R8 bundle-diet
// pass, 2026-08-23; see api/reference.ts's header for why): every consumer
// is the lazy magtools/hysteresis workshops. NOT re-exported by lib/api.ts;
// they import directly from this path.

import { postJSON } from "./http";
import type { CalcResult } from "../types";

/** Analyze an M-H loop -> Hc / Mr / Ms / squareness / loop area / SFD. */
export function hysteresisAnalysis(body: {
  h: number[];
  m: number[];
  saturation_fraction?: number;
  pre_smooth?: number;
  virgin_detect?: boolean;
}): Promise<CalcResult> {
  return postJSON("/api/magnetometry/hysteresis", body);
}

/** Subtract a linear high-T background from M(T) -> corrected moment + fit.
 *  M-vs-T ONLY: the window is one-sided, so on a hysteresis loop the intercept
 *  it removes carries +Ms and the loop is sheared down by that much. Use
 *  {@link subtractHysteresisBackground} for M(H) (BUG-021). Both routes take
 *  pydantic `list[float]`, which rejects the `null` a NaN stringifies to —
 *  drop gaps with `lib/api/finitePairs.ts` before calling. */
export function subtractMagBackground(body: {
  temperature: number[];
  moment: number[];
  fit_range?: [number, number] | null;
  auto_fraction?: number;
}): Promise<{ corrected: (number | null)[]; slope: number; intercept: number }> {
  return postJSON("/api/magnetometry/subtract-background", body);
}

/** Remove a linear dia/paramagnetic background from an M(H) loop: both
 *  saturated tails are fit separately, the average slope (susceptibility χ) is
 *  removed, and the loop is re-centred on its saturation midpoint. The third
 *  returned quantity is an `offset` — the vertical shift removed — NOT the
 *  intercept `subtractMagBackground` reports. */
export function subtractHysteresisBackground(body: {
  h: number[];
  m: number[];
  hi_fraction?: number;
  min_points?: number;
}): Promise<{ corrected: (number | null)[]; slope: number; offset: number }> {
  return postJSON("/api/magnetometry/subtract-hysteresis-background", body);
}

/** Convert field (x) + moment (y) units, sample-aware (emu→emu/g needs mass). */
export function convertMagUnits(body: {
  x: number[];
  y: number[];
  from_field?: string;
  to_field?: string;
  from_moment?: string;
  to_moment?: string;
  sample_mass?: number;
  sample_volume?: number;
}): Promise<{
  x: (number | null)[];
  y: (number | null)[];
  x_unit: string;
  y_unit: string;
  warning: string;
}> {
  return postJSON("/api/magnetometry/convert-units", body);
}
