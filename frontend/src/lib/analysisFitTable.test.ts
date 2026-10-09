import { describe, expect, it } from "vitest";

import { analysisFitTableCsv, fitParameterRows } from "./analysisFitTable";

describe("curve-fit parameter table", () => {
  it("aligns values, uncertainty, held state, and stable fallback names", () => {
    const rows = fitParameterRows({
      model: "Linear", params: [2, 1], errors: [0.1, null], fixed: [false, true],
    }, ["slope"]);
    expect(rows).toEqual([
      { name: "slope", value: 2, error: 0.1, fixed: false },
      { name: "p2", value: 1, error: null, fixed: true },
    ]);
  });

  it("neutralizes spreadsheet formulas in parameter names", () => {
    const csv = analysisFitTableCsv({ model: "Linear", params: [2] }, ["=2+2"]);
    expect(csv).toContain("'=2+2,2,,false");
  });
});
