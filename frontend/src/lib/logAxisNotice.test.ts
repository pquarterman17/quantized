import { describe, expect, it } from "vitest";

import { logHiddenNote } from "./logAxisNotice";
import type { PlotPayload } from "./plotdata";

const payload = (xs: number[], ys: number[]): PlotPayload => ({
  data: [xs, ys],
  series: [{ label: "A", unit: "" }],
  xLabel: "x",
  xUnit: "",
});
const view = { xScale: "linear", yScale: "log", y2Scale: null, y2Keys: null };

describe("logHiddenNote", () => {
  it("counts non-positive points hidden on a log Y axis", () => {
    expect(logHiddenNote(payload([1, 2, 3, 4], [5, -2, 0, 7]), [0], view)).toBe("2 non-positive points hidden on the log axis");
    expect(logHiddenNote(payload([1, 2], [5, -2]), [0], view)).toBe("1 non-positive point hidden on the log axis");
  });
  it("counts log X, once per point, and ignores gaps", () => {
    expect(logHiddenNote(payload([-1, 2, 0], [-1, NaN, 3]), [0], { ...view, xScale: "log" })).toBe("2 non-positive points hidden on the log axis");
  });
  it("says nothing on linear axes or when all points draw", () => {
    expect(logHiddenNote(payload([1, 2], [-5, 2]), [0], { ...view, yScale: "linear" })).toBeNull();
    expect(logHiddenNote(payload([1, 2], [5, 2]), [0], view)).toBeNull();
  });
});
