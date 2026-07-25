import { describe, expect, it } from "vitest";

import { describeLabelRow, labelRows, labelsFromRow, type LabelRow } from "./labelRows";
import type { DataStruct } from "./types";

const ds = (metadata: Record<string, unknown>): DataStruct => ({
  time: [1, 2],
  values: [
    [1, 2, 3],
    [4, 5, 6],
  ],
  labels: ["A", "B", "C"],
  units: ["", "", ""],
  metadata,
});

const rows = [
  { index: 0, role: "label", x: "Temp", cells: ["M1", "M2", "M3"] },
  { index: 2, role: "label", x: "", cells: ["NbAu-1", "", "NbAu-3"] },
  { index: 3, role: "header", x: "", cells: ["10 Oe", "50 Oe", "100 Oe"] },
];

describe("labelRows", () => {
  it("reads the preserved rows", () => {
    expect(labelRows(ds({ label_rows: rows }))).toHaveLength(3);
  });

  it("returns nothing for a dataset with no label rows", () => {
    expect(labelRows(ds({}))).toEqual([]);
    expect(labelRows(ds({ label_rows: "nonsense" }))).toEqual([]);
  });

  it("drops malformed entries rather than trusting the payload", () => {
    const mixed = [rows[0], { index: "x" }, { cells: [1, 2] }, null];
    expect(labelRows(ds({ label_rows: mixed }))).toHaveLength(1);
  });

  it("normalizes an unknown role to 'label'", () => {
    const odd = [{ index: 0, role: "banana", x: "", cells: ["a"] }];
    expect(labelRows(ds({ label_rows: odd }))[0].role).toBe("label");
  });
});

describe("labelsFromRow", () => {
  it("maps cells onto channel indices", () => {
    expect(labelsFromRow(rows[2] as LabelRow)).toEqual({
      0: "10 Oe",
      1: "50 Oe",
      2: "100 Oe",
    });
  });

  it("SKIPS blank cells instead of blanking a legend entry", () => {
    // A descriptive row is often sparse; writing "" would replace a real
    // parser-derived label with nothing, which is strictly worse.
    expect(labelsFromRow(rows[1] as LabelRow)).toEqual({ 0: "NbAu-1", 2: "NbAu-3" });
  });

  it("trims surrounding whitespace", () => {
    const padded: LabelRow = { index: 0, role: "label", x: "", cells: ["  a  ", " "] };
    expect(labelsFromRow(padded)).toEqual({ 0: "a" });
  });
});

describe("describeLabelRow", () => {
  it("previews the row's own content, which is what makes it recognizable", () => {
    expect(describeLabelRow(rows[0] as LabelRow)).toBe("M1, M2, M3");
  });

  it("marks the row currently supplying the labels", () => {
    expect(describeLabelRow(rows[2] as LabelRow)).toContain("(current)");
  });

  it("counts the overflow rather than listing everything", () => {
    const many: LabelRow = {
      index: 0,
      role: "label",
      x: "",
      cells: ["a", "b", "c", "d", "e"],
    };
    expect(describeLabelRow(many)).toBe("a, b, c, +2");
  });

  it("falls back to the row number when every cell is blank", () => {
    const blank: LabelRow = { index: 4, role: "label", x: "T", cells: ["", ""] };
    expect(describeLabelRow(blank)).toBe("row 5");
  });
});
