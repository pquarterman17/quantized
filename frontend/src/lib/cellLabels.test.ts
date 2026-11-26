// Heatmap cell-label rules, against the table the export asserts too
// (tests/fixtures/wire/annotation_measures.json, tests/test_cell_labels.py).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  cellLabelFits, contrastTextColor, formatCellValue, sanitizeCellLabels, type CellLabelFormat,
} from "./cellLabels";

const F = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "fixtures", "wire", "annotation_measures.json"),
    "utf8",
  ),
);

describe("cell label formatting", () => {
  it.each<{ v: number | null; format: CellLabelFormat; precision: number; text: string }>(F.cell_value)("$v $format/$precision", (c) => {
    expect(formatCellValue(c.v === null ? NaN : c.v, c.format, c.precision)).toBe(c.text);
  });
});

describe("cell label ink", () => {
  it.each<{ rgb: [number, number, number]; text: string }>(F.contrast)("$rgb", (c) => {
    expect(contrastTextColor(...c.rgb)).toBe(c.text);
  });
});

describe("the too-small cutoff", () => {
  it.each<{ cell_w: number; cell_h: number; text: string; font: number; fits: boolean }>(F.fits)("$cell_w x $cell_h '$text'", (c) => {
    expect(cellLabelFits(c.cell_w, c.cell_h, c.text, c.font)).toBe(c.fits);
  });
});

describe("sanitizeCellLabels", () => {
  it("clamps and defaults, and drops a non-object", () => {
    expect(sanitizeCellLabels({ format: "fixed", precision: 2 })).toEqual({ format: "fixed", precision: 2 });
    expect(sanitizeCellLabels({ format: "hex", precision: 99 })).toEqual({ format: "general", precision: 8 });
    expect(sanitizeCellLabels({ precision: -3 })).toEqual({ format: "general", precision: 0 });
    expect(sanitizeCellLabels(null)).toBeUndefined();
    expect(sanitizeCellLabels("on")).toBeUndefined();
  });
});
