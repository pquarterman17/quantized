import { describe, expect, it } from "vitest";

import { payloadToTSV, tableToTSV } from "./clipboard";
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

describe("tableToTSV", () => {
  it("joins headers and rows with tabs and newlines", () => {
    const tsv = tableToTSV(
      ["Field (Oe)", "M (emu)"],
      [
        [0, 1.5],
        [100, 2.5],
      ],
    );
    expect(tsv).toBe("Field (Oe)\tM (emu)\n0\t1.5\n100\t2.5");
  });

  it("renders null/undefined cells as empty fields (constant width)", () => {
    const tsv = tableToTSV(["a", "b", "c"], [[1, null, 3], [undefined, 5, 6]]);
    expect(tsv.split("\n")).toEqual(["a\tb\tc", "1\t\t3", "\t5\t6"]);
  });

  it("keeps full numeric precision (not the rounded display)", () => {
    expect(tableToTSV(["x"], [[0.123456789]])).toBe("x\n0.123456789");
  });

  it("emits just the header for no rows", () => {
    expect(tableToTSV(["x", "y"], [])).toBe("x\ty");
  });
});
