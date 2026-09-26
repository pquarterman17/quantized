// P2.5 review findings #3 / #4: the range/step defaults `withRangeDefaults`
// seeds must stay inside the source's own [lo, hi] even after the display
// rounding, and must be seeded from the dataset actually passed in (the
// caller, `useResample.ts`, is responsible for picking the right one and its
// analysis rows -- this only pins the rounding-inward contract itself).

import { describe, expect, it } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { defaultForm, withRangeDefaults } from "./resampleForm";

function ds(time: number[]): DataStruct {
  return { time, values: time.map(() => [0]), labels: ["Y"], units: [""], metadata: {} };
}

describe("withRangeDefaults", () => {
  it("keeps the defaults inside [lo, hi] even when 6-sig-fig rounding would push them out", () => {
    // 1/3 rounds DOWN to 0.333333 (below 1/3); 2/3 rounds UP to 0.666667
    // (above 2/3) -- toPrecision(6) alone violates both bounds here.
    const lo = 1 / 3;
    const hi = 2 / 3;
    const f = withRangeDefaults(defaultForm(""), ds([lo, hi]));
    expect(Number(f.start)).toBeGreaterThanOrEqual(lo);
    expect(Number(f.stop)).toBeLessThanOrEqual(hi);
  });

  it("still gives a tidy display value on ordinary ranges", () => {
    const f = withRangeDefaults(defaultForm(""), ds([0, 10]));
    expect(f.start).toBe("0");
    expect(f.stop).toBe("10");
    expect(f.step).toBe("0.1");
  });

  it("leaves fields the user already typed alone", () => {
    const f = withRangeDefaults({ ...defaultForm(""), start: "2" }, ds([0, 10]));
    expect(f.start).toBe("2");
    expect(f.stop).toBe("10");
  });

  it("is a no-op without a usable range (no data, or a single point)", () => {
    const base = defaultForm("");
    expect(withRangeDefaults(base, undefined)).toEqual(base);
    expect(withRangeDefaults(base, ds([5, 5]))).toEqual(base);
  });
});
