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

/** Per-side merge of a committed limit over a fallback extent (`?? extent`
 *  for a half-open pair) — for consumers that already fall back to a data
 *  domain when the limit is null. Crossing falls back to the extent. */
export function limOr<E extends [number, number] | null>(lim: HalfLim | null | undefined, extent: E): [number, number] | E {
  if (!lim) return extent;
  return resolveHalfLim(lim, extent).range ?? extent;
}
