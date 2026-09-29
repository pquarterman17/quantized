// The Peaks workshop's detector settings (/api/peaks/find) — every knob the
// route takes, with the route's own defaults. Only the fields a user CHANGED
// go on the wire (`findOverrides`), so an untouched panel sends exactly the
// `{x, y}` it always did and the backend's defaults stay the single source.
//
// The "_deg" names are the route's: they are x-axis units, which are degrees
// only for a 2θ scan — hence the panel labels them by role, not unit.

export type PeakSensitivity = "low" | "medium" | "high";
export type PeakFindBackground = "snip" | "polynomial";

export interface PeakFindParams {
  sensitivity: PeakSensitivity;
  snr_threshold: number;
  min_prominence: number;
  max_peaks: number;
  min_separation: number;
  min_width_deg: number;
  max_width_deg: number;
  bg_method: PeakFindBackground;
  max_window_deg: number;
  bg_poly_degree: number;
  bg_iterative: boolean;
}

/** Mirrors `routes/peaks.py`'s `FindPeaksRequest` defaults. */
export const DEFAULT_PEAK_FIND: Readonly<PeakFindParams> = Object.freeze({
  sensitivity: "medium",
  snr_threshold: 5,
  min_prominence: 0.02,
  max_peaks: 50,
  min_separation: 0,
  min_width_deg: 0.01,
  max_width_deg: 10,
  bg_method: "snip",
  max_window_deg: 2,
  bg_poly_degree: 4,
  bg_iterative: false,
});

/** The fields of `p` that differ from the defaults — the request extras. */
export function findOverrides(p: PeakFindParams): Partial<PeakFindParams> {
  const out: Partial<Record<keyof PeakFindParams, unknown>> = {};
  for (const k of Object.keys(DEFAULT_PEAK_FIND) as (keyof PeakFindParams)[]) {
    if (p[k] !== DEFAULT_PEAK_FIND[k]) out[k] = p[k];
  }
  return out as Partial<PeakFindParams>;
}
