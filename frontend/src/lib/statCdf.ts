// The CDF / ECDF plot's pure math and the rug option (plan item 20). The
// vertices built here are the ones `calc/statplots_cdf.py` builds for the
// matplotlib export; both are pinned to `tests/fixtures/wire/stat_cdf_rug.json`
// (`Stage/statCdfParity.test.ts`, `tests/test_stat_cdf_rug.py`), so the canvas
// and the exported figure draw the same steps, band, fit and ticks.
//
// The numbers (ECDF, DKW band, fitted CDF) come from `POST /api/statplots/cdf`;
// nothing is re-derived here, only turned into vertices.

export type CdfY = "proportion" | "count";
export type Pt = [number, number];

/** One column of a `/api/statplots/cdf` response. */
export interface CdfWireSeries {
  n: number;
  x: number[];
  y: number[];
  band?: { eps: number; lo: number[]; hi: number[]; lo0: number; hi0: number } | null;
  fit?: { dist: string; params: number[]; x: number[]; y: number[] } | null;
}
export interface CdfWire {
  y: CdfY;
  domain: [number, number];
  y_max: number;
  alpha: number;
  fit: string | null;
  series: CdfWireSeries[];
}

export * from "./statCdfGeometry";

// ── Rug marks ────────────────────────────────────────────────────────────────

export const RUG_LENGTH = { min: 0.01, max: 0.25, default: 0.04 } as const;
export const RUG_OPACITY = { min: 0.05, max: 1, default: 0.5 } as const;

/** The persisted rug option, SPARSE (absent = off; unset numbers = defaults). */
export interface RugPick {
  on?: boolean;
  length?: number;
  opacity?: number;
}
export interface ResolvedRug {
  length: number;
  opacity: number;
}

/** The rug to draw, or null when it is off. */
export function resolveRug(p: RugPick | null | undefined): ResolvedRug | null {
  return p?.on ? { length: p.length ?? RUG_LENGTH.default, opacity: p.opacity ?? RUG_OPACITY.default } : null;
}

/** A persisted rug option: only well-formed, in-range fields survive. */
export function sanitizeRugPick(v: unknown): RugPick | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const o = v as Record<string, unknown>;
  const num = (x: unknown, r: { min: number; max: number }) =>
    typeof x === "number" && Number.isFinite(x) && x >= r.min && x <= r.max ? x : undefined;
  const out: RugPick = {};
  if (o.on === true) out.on = true;
  const length = num(o.length, RUG_LENGTH);
  const opacity = num(o.opacity, RUG_OPACITY);
  if (length !== undefined) out.length = length;
  if (opacity !== undefined) out.opacity = opacity;
  return Object.keys(out).length ? out : undefined;
}
