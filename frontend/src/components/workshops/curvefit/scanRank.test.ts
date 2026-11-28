import { describe, expect, it } from "vitest";

import type { ScanEntry } from "../../../lib/api/curvefit";
import { bestEntry, sortScan } from "./scanRank";

const e = (name: string, over: Partial<ScanEntry> = {}): ScanEntry => ({
  name, kind: "registry", error: null, k: 2, params: [], paramNames: [], R2: 0.9, RMSE: 1, AIC: 1, AICc: 1,
  deltaAICc: 0, weight: 0.1, adjR2: 0.9, chiSqRed: 1, BIC: 1, converged: true, ...over,
});
const failed = e("bad", { error: "no", k: null, AICc: null, AIC: null, BIC: null, adjR2: null, chiSqRed: null, converged: null });

describe("scanRank", () => {
  it("the best is the first converged row of the backend ranking, skipping unconverged and failed", () => {
    const rows = [e("stalled", { converged: false }), failed, e("good"), e("later")];
    expect(bestEntry(rows)?.name).toBe("good");
    expect(bestEntry([e("a", { converged: false }), failed])).toBeNull();
  });

  it("a perfect fit (AICc null on the wire) can still be best", () => {
    expect(bestEntry([e("perfect", { AICc: null, AIC: null })])?.name).toBe("perfect");
  });

  it("sorts best-first per column: R²adj descending, AIC ascending; failures and NaN stay last, in their original order", () => {
    const rows = [e("a", { adjR2: 0.5, AIC: 5 }), e("b", { adjR2: 0.99, AIC: 9 }), failed, e("c", { adjR2: Number.NaN, AIC: 1 })];
    expect(sortScan(rows, { key: "adjR2", dir: "desc" }).map((r) => r.name)).toEqual(["b", "a", "bad", "c"]);
    expect(sortScan(rows, { key: "AIC", dir: "asc" }).map((r) => r.name)).toEqual(["c", "a", "b", "bad"]);
    expect(sortScan(rows, null).map((r) => r.name)).toEqual(["a", "b", "bad", "c"]);
  });
});
