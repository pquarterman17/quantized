// Lazy-renderer half of ticks.ts. Map/stat/polar surfaces load behind Stage
// seams; keeping their classic 1-2-5 tick generator here avoids charging it
// to the initial plot bundle.

import { pow10 } from "./ticks";

function niceStep(raw: number): number {
  if (raw <= 0 || !Number.isFinite(raw)) return 1;
  const mag = pow10(Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  return (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
}

/** Round tick values within [lo, hi], aiming for roughly `target` ticks. */
export function niceTicks(lo: number, hi: number, target = 5): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return [lo];
  const step = niceStep((hi - lo) / Math.max(1, target));
  const start = Math.ceil(lo / step) * step;
  const out: number[] = [];
  for (let v = start, i = 0; v <= hi + step * 1e-6 && i < 1000; v += step, i++) {
    out.push(Math.round(v / step) * step);
  }
  return out.length ? out : [lo, hi];
}
