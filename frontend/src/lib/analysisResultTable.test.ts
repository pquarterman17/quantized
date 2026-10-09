import { describe, expect, it } from "vitest";

import { analysisResultTableCsv } from "./analysisResultTable";

describe("analysisResultTableCsv", () => {
  it("exports every row and protects imported spreadsheet labels", () => {
    expect(analysisResultTableCsv({ data: {
      time: [0, 1], values: [[2, Number.NaN], [3, 4]],
      labels: ["=signal", "note, two"], units: ["V", "V"],
      metadata: { xLabel: "Time" },
    } })).toBe("Time,'=signal,\"note, two\"\r\n0,2,\r\n1,3,4");
  });
});
