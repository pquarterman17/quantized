import { describe, expect, it } from "vitest";

import type { Dataset } from "../../../lib/types";
import { facetRefusal, MAX_FACET_LEVELS } from "./facetGuard";

const N = 60;
const ds: Dataset = {
  id: "d",
  name: "gb.csv",
  data: {
    time: Array.from({ length: N }, (_, i) => i),
    // ch0 continuous (60 distinct values), ch1 three levels
    values: Array.from({ length: N }, (_, i) => [100 + i * 0.5, i % 3]),
    labels: ["Temp_K", "lot"],
    units: ["K", ""],
    metadata: {},
  },
};

describe("facetRefusal", () => {
  it("refuses a continuous column (one panel per value) and says why and what to do", () => {
    const why = facetRefusal(ds, 0);
    expect(why).toContain("60 distinct values");
    expect(why).toContain(`at most ${MAX_FACET_LEVELS}`);
    expect(why).toContain("bin");
  });

  it("accepts a few-level column", () => {
    expect(facetRefusal(ds, 1)).toBeNull();
  });
});
