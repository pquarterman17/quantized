import { describe, expect, it } from "vitest";

import { payloadToTSV } from "./clipboard";
import type { PlotPayload } from "./plotdata";

describe("payloadToTSV", () => {
  const base: PlotPayload = {
    data: [
      [0, 1, 2],
      [10, 20, 30],
      [100, 200, 300],
    ],
    series: [
      { label: "M", unit: "emu" },
      { label: "T", unit: "K" },
    ],
    xLabel: "Field",
    xUnit: "Oe",
  };

  it("writes a header row with x + each series (label + unit)", () => {
    const lines = payloadToTSV(base).split("\n");
    expect(lines[0]).toBe("Field (Oe)\tM (emu)\tT (K)");
  });

  it("writes one tab-separated row per data point", () => {
    const lines = payloadToTSV(base).split("\n");
    expect(lines).toHaveLength(4); // header + 3 rows
    expect(lines[1]).toBe("0\t10\t100");
    expect(lines[3]).toBe("2\t30\t300");
  });

  it("renders null cells (gaps) as empty fields, keeping the row width", () => {
    const withGap: PlotPayload = {
      ...base,
      data: [
        [0, 1, 2],
        [10, null, 30],
        [100, 200, null],
      ],
    };
    const lines = payloadToTSV(withGap).split("\n");
    expect(lines[2]).toBe("1\t\t200"); // M gap, T present
    expect(lines[3]).toBe("2\t30\t"); // T gap
  });

  it("omits the unit parens when a label has no unit", () => {
    const noUnit: PlotPayload = { ...base, xUnit: "", series: [{ label: "fit", unit: "" }], data: [[0], [1]] };
    expect(payloadToTSV(noUnit).split("\n")[0]).toBe("Field\tfit");
  });

  it("handles an empty payload (header only)", () => {
    const empty: PlotPayload = { data: [[]], series: [], xLabel: "x", xUnit: "" };
    expect(payloadToTSV(empty)).toBe("x");
  });
});
