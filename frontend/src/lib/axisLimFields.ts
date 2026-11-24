// The min/max FIELD side of half-open limits (P2.8 residual (b), see
// `lib/axisLim.ts`): parsing a typed pair, showing a committed one, and the
// per-side fallback the lazy multi-panel/peaks consumers use. Kept out of
// `axisLim.ts` because every consumer here is lazy (the Inspector cards, the
// map toolbar, the workshops) while that module is in the eager graph.

import { resolveHalfLim, type HalfLim } from "./axisLim";

/** What a min/max field pair commits: `null` = fully auto, a pair = fixed or
 *  half-open (a blank side is auto for that side, never `Number("") === 0`),
 *  `undefined` = not a valid entry (non-numeric, or both sides typed with
 *  min >= max) — the caller leaves the stored value alone. */
export function parseLimFields(minStr: string, maxStr: string): HalfLim | null | undefined {
  const side = (s: string): number | null | undefined => {
    const t = s.trim();
    if (t === "") return null;
    const v = Number(t);
    return Number.isFinite(v) ? v : undefined;
  };
  const lo = side(minStr);
  const hi = side(maxStr);
  if (lo === undefined || hi === undefined) return undefined;
  if (lo === null && hi === null) return null;
  if (lo !== null && hi !== null && !(lo < hi)) return undefined;
  return [lo, hi];
}

/** The field text for one side of a committed pair ("" = auto). */
export function limFieldText(lim: HalfLim | null, side: 0 | 1): string {
  const v = lim?.[side];
  return v == null ? "" : String(v);
}

/** The DISPLAYED field text for one side: `limFieldText` rounded to 6
 *  significant digits so an autoscaled limit ("2.0031834") fits a narrow
 *  Inspector field (UX audit 10 P2-11). Display only: the committed value keeps
 *  full precision, so a field that still shows its own display text is NOT a
 *  new entry (`limFieldUnchanged`). */
export function limFieldDisplay(lim: HalfLim | null, side: 0 | 1): string {
  const v = lim?.[side];
  return v == null ? "" : String(Number(v.toPrecision(6)));
}

/** True when both field texts are still exactly what `limFieldDisplay` shows
 *  for `lim`, i.e. the user typed nothing and a blur must not re-commit the
 *  rounded text over the full-precision limit. */
export function limFieldUnchanged(lim: HalfLim | null, minStr: string, maxStr: string): boolean {
  return minStr === limFieldDisplay(lim, 0) && maxStr === limFieldDisplay(lim, 1);
}

/** Per-side merge of a committed limit over a fallback extent (`?? extent`
 *  for a half-open pair) — for consumers that already fall back to a data
 *  domain when the limit is null. Crossing falls back to the extent. */
export function limOr<E extends [number, number] | null>(lim: HalfLim | null | undefined, extent: E): [number, number] | E {
  if (!lim) return extent;
  return resolveHalfLim(lim, extent).range ?? extent;
}
