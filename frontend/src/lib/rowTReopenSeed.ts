// "Open in Statistical tests" for a committed row-wise t-test worksheet: the
// recorded design, variance model, null value, adjustment, alpha, alternative
// and the two column groups, read back strictly. FAIL CLOSED: null unless every
// field is present and of the right type (a partial record is never seeded). A
// record saved before the p adjustment existed has no `adjust` and meant "none".
// Lazy: imported by the lazy opener only (store/toolReopenOpen.ts, toolReopenPicks.ts).

import type { ReopenSeed } from "./committedOutputReopen";
import type { Alternative, TestParams, TestSelection } from "./statsTests";
import { DEFAULT_SELECTION } from "./statsTests";
import { ROWT_ADJUSTMENTS } from "./rowTestWorksheet";
import { DEFAULT_ROWT, ROWT_DESIGNS, ROWT_VARIANCES, type RowTParams } from "./statsTestsRows";

export interface RowTSeed {
  selection: TestSelection;
  rowt: RowTParams;
  alpha: number;
  alternative: Alternative;
}

const ALTERNATIVES: readonly Alternative[] = ["two-sided", "less", "greater"];
const columns = (v: unknown): v is number[] => Array.isArray(v) && v.every((n) => Number.isInteger(n) && n >= 0);

export function rowTSeed(s: ReopenSeed | null | undefined): RowTSeed | null {
  if (!s || s["testId"] !== "row-t-tests") return null;
  const { design, variance, mu, groupA, groupB, alpha, alternative } = s;
  const adjust = s["adjust"] === undefined ? "none" : s["adjust"];
  if (!ROWT_DESIGNS.some((d) => d.id === design) || !ROWT_VARIANCES.some((v) => v.id === variance)
    || !ROWT_ADJUSTMENTS.some((a) => a.id === adjust)
    || typeof mu !== "number" || !Number.isFinite(mu)
    || typeof alpha !== "number" || !(alpha > 0 && alpha < 1)
    || !ALTERNATIVES.includes(alternative as Alternative)
    || !columns(groupA) || !columns(groupB)) return null;
  return {
    selection: { ...DEFAULT_SELECTION, cols: [...groupA] },
    rowt: { ...DEFAULT_ROWT, groupB: [...groupB], design, variance, mu, adjust } as RowTParams,
    alpha, alternative: alternative as Alternative,
  };
}

/** The test request the Statistical tests panel takes. */
export const rowTParams = (seed: RowTSeed, defaults: TestParams): TestParams =>
  ({ ...defaults, alpha: seed.alpha, alternative: seed.alternative, rowt: seed.rowt });
