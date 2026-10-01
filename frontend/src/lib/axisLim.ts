// Half-open min/max limit pairs (PRIMARY_SOFTWARE_AUDIT_PLAN P2.8 residual
// (b)). A committed limit is `null` (fully auto) or a `[lo, hi]` pair in which
// either side may be `null`, meaning "auto for that side": the other side is
// honoured and the blank side comes from the data/autoscale extent at render
// time. Before this, a blank field read as `Number("") === 0`, so leaving the
// minimum blank silently fixed the axis at [0, hi] while the field still
// showed its "auto" placeholder.
//
// Shared by the plot's X/Y limits (`AxisLimits.tsx`, resolved against the
// canvas' scanned extents by `lib/canvasLims.ts`) and the map's colour limits
// (`useMapColorLimitsField`, resolved by `mapRender.effectiveColorLimits`).
// A JSON round-trip keeps the shape as-is (`null` serializes as `null`), so a
// saved workspace reopens half-open; the export wire takes a `null` side too
// (`FigureOverrides.x_lim`, matplotlib's own `set_xlim(None, hi)`).
//
// Only what the EAGER graph needs lives here (the canvas, the store's
// sanitizers); the field-parsing helpers the lazy Inspector/workshop
// consumers use are in `lib/axisLimFields.ts` (eager-bundle budget).

/** A committed limit pair; a `null` side is auto for that side. */
export type HalfLim = [number | null, number | null];

/** The pair when BOTH sides are fixed, else `null` — for a consumer that
 *  only acts on a fully fixed window (the zoom re-fetch). */
export function fixedLim(lim: HalfLim | null | undefined): [number, number] | null {
  return lim && lim[0] !== null && lim[1] !== null ? (lim as [number, number]) : null;
}

/** A resolved limit, plus whether an explicit side crossed the auto side
 *  (`lo >= hi` once the blank side is filled) and fell back to full auto. */
export interface ResolvedLim {
  range: [number, number] | null;
  crossed: boolean;
}

/** Fill a half-open pair's blank side from `auto` (the extent autoscale would
 *  use). A fully fixed pair passes through untouched (an Origin figure's
 *  descending pair is a deliberate reversed axis, not a crossing). When the
 *  auto extent is unknown, or the explicit side would land on or past the
 *  auto side, the whole axis falls back to auto (`range: null`), and a
 *  crossing is reported so the caller can say why. */
export function resolveHalfLim(lim: HalfLim | null | undefined, auto: readonly [number, number] | null): ResolvedLim {
  const fixed = fixedLim(lim);
  if (fixed || !lim || !auto || lim[0] === lim[1]) return { range: fixed, crossed: false }; // lim[0] === lim[1]: both null
  const r: [number, number] = [lim[0] ?? auto[0], lim[1] ?? auto[1]];
  const crossed = !(r[0] < r[1]);
  return { range: crossed ? null : r, crossed };
}

/** Restore a persisted limit: a fixed pair, a half-open pair (one finite
 *  side, the other `null`), or `null`. Anything else is dropped to auto. */
export function sanitizeHalfLim(v: unknown): HalfLim | null {
  const ok = (x: unknown) => x === null || (typeof x === "number" && Number.isFinite(x));
  return Array.isArray(v) && v.length === 2 && ok(v[0]) && ok(v[1]) && (v[0] !== null || v[1] !== null)
    ? [v[0] as number | null, v[1] as number | null]
    : null;
}
