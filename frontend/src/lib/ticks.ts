// "Nice" axis tick positions — round 1-2-5 × 10^n values inside a range, the
// classic algorithm (Heckbert). Pure + used by the 2-D map axes; keeps tick
// labels human (60, 60.5, 61 …) instead of raw fractional linspace endpoints.

/** Exact 10^k for integer k. `Math.pow(10, k)` is NOT correctly-rounded per
 *  spec and differs across V8 builds (ubuntu CI returned 9.999999999999999e-6
 *  for k=-5 where local Windows returned 1e-5); parsing the decimal literal
 *  IS correctly rounded everywhere, so decade tick values stay exact on every
 *  platform. */
export function pow10(k: number): number {
  return Number.isInteger(k) ? Number(`1e${k}`) : Math.pow(10, k);
}

/** Decimal places needed to render tick-increment `incr` without collapsing
 *  distinct ticks to the same label (MAIN #20, owner bug report) — the floor
 *  a fixed-decimal axis formatter must never go below. Starts from the log10
 *  order of magnitude (`0.0001` -> 4), then round-trips (`toFixed` -> parse
 *  -> compare) upward for "nice" non-power-of-10 steps (0.25, 1.25, 2.5e-n,
 *  …) whose exact decimal form needs a digit or two more than `-log10(incr)`
 *  alone implies (0.25 needs 2 decimals, not the 1 that formula gives).
 *  Non-positive/non-finite `incr` (no usable increment — degenerate range,
 *  or the caller only has a single split) returns 0: the configured/default
 *  digit count applies with no floor, same as the pre-fix behaviour. */
export function decimalsForIncrement(incr: number, maxDecimals = 20): number {
  if (!(incr > 0) || !Number.isFinite(incr)) return 0;
  let d = Math.max(0, Math.min(maxDecimals, Math.ceil(-Math.log10(incr) - 1e-9)));
  const tol = Math.max(incr * 1e-6, 1e-15);
  while (d < maxDecimals && Math.abs(Number(incr.toFixed(d)) - incr) > tol) d += 1;
  return d;
}
