import { describe, expect, it } from "vitest";

import type { DataStruct } from "./types";
import {
  expandParamTemplate,
  orderColumnsByParam,
  parseParamNumber,
  userParamRows,
  userParamValue,
  withParamCell,
  withoutParam,
} from "./userParams";

const data = (rows: unknown[]): DataStruct => ({
  time: [0],
  values: [[1, 2, 3]],
  labels: ["a", "b", "c"],
  units: ["V", "V", ""],
  metadata: { label_rows: rows },
});

const T = { index: 0, role: "label", x: "Temperature", cells: ["300 K", "10", ""] };

describe("userParamRows", () => {
  it("reads a named descriptive row (name, else the x-column caption) as a parameter", () => {
    const d = data([T, { index: 1, role: "label", name: "Sample", x: "", cells: ["S1", "S2", "S3"] }]);
    expect(userParamRows(d).map((r) => r.name)).toEqual(["Temperature", "Sample"]);
  });

  it("ignores header/units/comment rows, unnamed rows and repeated names (first wins)", () => {
    const d = data([
      { index: 0, role: "header", x: "Name", cells: ["a", "b", "c"] },
      { index: 1, role: "units", x: "Unit", cells: ["", "", ""] },
      { index: 2, role: "label", x: "", cells: ["?", "?", "?"] },
      T,
      { index: 4, role: "label", x: "Temperature", cells: ["9", "9", "9"] },
    ]);
    const rows = userParamRows(d);
    expect(rows).toHaveLength(1);
    expect(userParamValue(rows, "Temperature", 0)).toBe("300 K");
  });

  it("is empty for a dataset without label rows or with malformed ones", () => {
    expect(userParamRows({ metadata: {} })).toEqual([]);
    expect(userParamRows({ metadata: { label_rows: [null, 3, { role: "label", x: "T" }] } })).toEqual([]);
  });
});

describe("parseParamNumber", () => {
  it.each([
    ["300", 300], ["-5.5 K", -5.5], ["1e-3 T", 1e-3], [" 12 ", 12], ["50%", 50], [".5", 0.5],
  ])("%s -> %s", (text, v) => expect(parseParamNumber(text)).toBe(v));
  it.each(["", "abc", "5th", "A1", "1,5", "1.2.3", "NaN"])("%j is not numeric", (text) => {
    expect(parseParamNumber(text)).toBeNull();
  });
});

describe("withParamCell / withoutParam", () => {
  it("creates a row, pads to the channel count, edits a cell in place, and clears with blank", () => {
    const made = withParamCell({}, "Field", 1, " 5 T ", 3);
    expect(made).toEqual([{ index: 0, role: "label", name: "Field", x: "Field", cells: ["", "5 T", ""] }]);
    const next = withParamCell({ label_rows: made }, "Field", 2, "7 T", 3);
    expect(userParamValue(userParamRows(data(next)), "Field", 2)).toBe("7 T");
    const cleared = withParamCell({ label_rows: next }, "Field", 1, "", 3);
    expect(userParamValue(userParamRows(data(cleared)), "Field", 1)).toBe("");
  });

  it("never reuses an existing row index and keeps file rows untouched", () => {
    const made = withParamCell({ label_rows: [T] }, "Sample", 0, "S1", 3) as { index: number }[];
    expect(made.map((r) => r.index)).toEqual([0, 1]);
    expect(withParamCell({ label_rows: [T] }, "Temperature", 2, "5", 3)[0]).toMatchObject({ x: "Temperature", cells: ["300 K", "10", "5"] });
  });

  it("removes only the named parameter row", () => {
    const rows = withoutParam({ label_rows: [T, { index: 1, role: "header", x: "Temperature", cells: [] }] }, "Temperature");
    expect(rows).toEqual([{ index: 1, role: "header", x: "Temperature", cells: [] }]);
  });
});

describe("expandParamTemplate", () => {
  const d = data([T]);
  it("fills parameters and the column's own label / unit / comment", () => {
    expect(expandParamTemplate("{Temperature} · {label} [{unit}] {comment}", d, 0, "probe")).toEqual({ text: "300 K · a [V] probe" });
  });
  it("fails closed on an unknown name and on a column without a value (never a hole in the label)", () => {
    expect(expandParamTemplate("{Nope}", d, 0, "")).toEqual({ error: "unknown parameter {Nope}" });
    expect(expandParamTemplate("T = {Temperature}", d, 2, "")).toEqual({ error: "no {Temperature} value" });
  });
  it("a parameter named like a reserved token wins", () => {
    const named = data([{ index: 0, role: "label", x: "label", cells: ["mine", "", ""] }]);
    expect(expandParamTemplate("{label}", named, 0, "")).toEqual({ text: "mine" });
  });
});

describe("orderColumnsByParam", () => {
  const d = data([{ index: 0, role: "label", x: "T", cells: ["30 K", "10", "n/a"] }]);
  it("sorts numerically (not as text) and leaves non-numeric columns last, counted", () => {
    expect(orderColumnsByParam(d, "T", [0, 1, 2], 1)).toEqual({ order: [1, 0, 2], unordered: 1 });
    expect(orderColumnsByParam(d, "T", [0, 1, 2], -1)).toEqual({ order: [0, 1, 2], unordered: 1 });
  });
  it("10 sorts before 9 only as text -- numerically 9 < 10", () => {
    const e = data([{ index: 0, role: "label", x: "T", cells: ["10", "9", "100"] }]);
    expect(orderColumnsByParam(e, "T", [0, 1, 2], 1).order).toEqual([1, 0, 2]);
  });
});
