import { describe, expect, it } from "vitest";

import type { Dataset } from "./types";
import { buildCompareWorksheet, readCompareSeries, sharedAxis } from "./magSeriesCompare";

function sheet(id: string, over: Partial<Dataset["data"]> = {}, roles: Dataset["errorRoles"] = []): Dataset {
  return {
    id, name: `${id}.dat`,
    data: {
      time: [10, 20, 30],
      values: [[1, 0.1], [2, 0.2], [3, 0.3]],
      labels: ["Moment", "Moment err"],
      units: ["emu", "emu"],
      metadata: { x_column_name: "Temperature", x_column_unit: "K" },
      ...over,
    },
    errorRoles: roles,
  };
}
const yErr: Dataset["errorRoles"] = [{ channel: 1, target: 0, axis: "y", side: "both" }];

describe("readCompareSeries", () => {
  it("reads declared temperature, units and committed Y uncertainty", () => {
    const s = readCompareSeries(sheet("a", {}, yErr), "Moment");
    expect(s).toMatchObject({ axis: "temperature", xUnit: "K", yUnit: "emu", rowsUsed: 3, rowsDropped: 0 });
    expect(s.yErrors[0]!.values).toEqual([0.1, 0.2, 0.3]);
  });

  it("drops rows without finite X and Y and counts them", () => {
    const d = sheet("a", { values: [[1, 0.1], [Number.NaN, 0.2], [3, 0.3]] }, yErr);
    const s = readCompareSeries(d, "Moment");
    expect(s.x).toEqual([10, 30]);
    expect(s.yErrors[0]!.values).toEqual([0.1, 0.3]);
    expect(s.rowsDropped).toBe(1);
  });

  it.each([
    ["missing column", sheet("a"), "Nope", /No column named/],
    ["blank y unit", sheet("a", { units: ["", ""] }), "Moment", /no declared unit/],
    ["undeclared x", sheet("a", { metadata: { x_column_name: "Row" } }), "Moment", /not a declared field or temperature/],
    ["x uncertainty", sheet("a", {}, [{ channel: 1, target: -1, axis: "x", side: "both" }]), "Moment", /X uncertainty/],
    ["error unit differs", sheet("a", { units: ["emu", "Oe"] }, yErr), "Moment", /uncertainty column/],
  ])("refuses %s", (_n, ds, channel, re) => {
    expect(() => readCompareSeries(ds, channel)).toThrow(re);
  });
});

describe("sharedAxis / buildCompareWorksheet", () => {
  it("refuses mixed field and temperature axes", () => {
    const h = sheet("h", { metadata: { x_column_name: "Magnetic field", x_column_unit: "Oe" } });
    expect(() => sharedAxis([readCompareSeries(sheet("t"), "Moment"), readCompareSeries(h, "Moment")])).toThrow(/mix field and temperature/);
  });

  it("lays out X,Y pairs with scaled values and uncertainty, padding the shorter series with gaps", () => {
    const a = readCompareSeries(sheet("a", {}, yErr), "Moment");
    const b = readCompareSeries(sheet("b", { time: [5, 15], values: [[10, 1], [20, 2]] }, yErr), "Moment");
    const w = buildCompareWorksheet([a, b], {
      x_unit: "K", y_unit: "emu",
      series: [{ x_factor: 1, y_factor: 1 }, { x_factor: 1, y_factor: -2 }],
    });
    expect(w.data.time).toEqual([10, 20, 30]);
    expect(w.data.labels).toEqual(["Moment [a.dat]", "Moment err [a.dat]", "Temperature [b.dat]", "Moment [b.dat]", "Moment err [b.dat]"]);
    expect(w.data.values[0]).toEqual([1, 0.1, 5, -20, 2]);
    expect(w.data.values[2]).toEqual([3, 0.3, Number.NaN, Number.NaN, Number.NaN]);
    expect(w.errorRoles).toEqual([
      { channel: 1, target: 0, axis: "y", side: "both" },
      { channel: 4, target: 3, axis: "y", side: "both" },
    ]);
    expect(w.columnDesignations).toEqual({ 0: "Y", 1: "Y-error", 2: "X", 3: "Y", 4: "Y-error" });
    expect(w.data.metadata["magnetometry_series_comparison"]).toMatchObject({ resampled: false, reference: "a.dat" });
  });

  it("keeps duplicate worksheet names distinct", () => {
    const a = readCompareSeries(sheet("a"), "Moment");
    const b = { ...readCompareSeries(sheet("b"), "Moment"), name: "a.dat" };
    const w = buildCompareWorksheet([a, b], { x_unit: "K", y_unit: "emu", series: [{ x_factor: 1, y_factor: 1 }, { x_factor: 1, y_factor: 1 }] });
    expect(w.data.labels[2]).toBe("Moment [a.dat (2)]");
  });
});
