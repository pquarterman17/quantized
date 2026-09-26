// Wire encoding of fit bounds — ±Infinity <-> `null` — split out of
// lib/fitParams.ts (which re-exports both, so its importers are unchanged).
//
// Its own module because the recalc graph (store/recalcFits.ts) is EAGER and
// needs only `boundsFromWire`; importing it from fitParams dragged the whole
// fit-table parser and lib/paramRowCheck.ts into the entry chunk with it
// (~1.5 kB of code only the Curve Fit workshop runs). Split for the P2.7
// fit-models-in-workspace follow-up, which needed the eager headroom.

/** Wire-shaped bounds: `null` where unbounded, so a recorded recipe round-trips
 *  through JSON (which has no Infinity literal — a bare Infinity serializes to
 *  `null` anyway, and relying on that is how a bound silently becomes garbage). */
export function boundsForWire(values: readonly number[]): (number | null)[] {
  return values.map((v) => (Number.isFinite(v) ? v : null));
}

/** Inverse of `boundsForWire` — restore ±Infinity from a recorded recipe. */
export function boundsFromWire(
  values: readonly (number | null)[] | undefined,
  sign: 1 | -1,
): number[] | undefined {
  if (!values) return undefined;
  return values.map((v) => (v == null ? sign * Number.POSITIVE_INFINITY : v));
}
