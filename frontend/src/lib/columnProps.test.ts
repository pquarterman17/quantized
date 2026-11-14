// Per-column display formats and Comments (worksheet audit #12/#18): there
// was no way to set decimals / scientific / significant digits on a column,
// and no Comments row for a non-Origin sheet. Display only; round-trips .dwk.

import { describe, expect, it } from "vitest";

import { gridFormatters } from "../components/Stage/worksheet/cellFormat";
import { clampDigits, formatNumber, patchColumnProps, sanitizeColumnProps } from "./columnProps";
import type { Dataset } from "./types";
import { parseWorkspaceDataset } from "./workspaceDatasetParse";
import { serializeWorkspace } from "./workspaceSerialize";

describe("number formats", () => {
  it("formats decimal places, scientific and significant digits; blanks stay a dash", () => {
    expect(formatNumber(3.14159, { kind: "decimal", digits: 2 })).toBe("3.14");
    expect(formatNumber(1234.5, { kind: "sci", digits: 2 })).toBe("1.23e+3");
    expect(formatNumber(0.000123456, { kind: "sig", digits: 3 })).toBe("0.000123");
    expect(formatNumber(Number.NaN, { kind: "decimal", digits: 2 })).toBe("—");
    expect(clampDigits("sig", 0)).toBe(1);
    expect(clampDigits("decimal", 99)).toBe(17);
  });

  it("the grid uses a column's own format and leaves the others automatic", () => {
    const fmt = gridFormatters([1, 2], [[0.5, 1234.5678], [0.25, 2]], { 1: { format: { kind: "decimal", digits: 1 } } });
    expect(fmt(1)(1234.5678)).toBe("1234.6");
    expect(fmt(0)(0.5)).toBe("0.5000");
  });
});

describe("column props map", () => {
  it("patches one column, drops emptied entries and an emptied map", () => {
    const p = patchColumnProps(undefined, 2, { comment: "probe" });
    expect(p).toEqual({ 2: { comment: "probe" } });
    expect(patchColumnProps(p, 2, { comment: "" })).toBeUndefined();
  });

  it("a .dwk keeps valid entries only (in-range keys, known kinds)", () => {
    expect(
      sanitizeColumnProps(
        { "-1": { comment: "time" }, 0: { format: { kind: "sci", digits: 3 } }, 5: { comment: "gone" }, 1: { format: { kind: "bogus", digits: 2 } } },
        2,
      ),
    ).toEqual({ [-1]: { comment: "time" }, 0: { format: { kind: "sci", digits: 3 } } });
  });

  it("round-trips through a saved workspace", () => {
    const ds: Dataset = {
      id: "a",
      name: "a",
      data: { time: [1], values: [[2]], labels: ["A"], units: [""], metadata: {} },
      columnProps: { 0: { comment: "c", format: { kind: "decimal", digits: 3 } } },
    };
    const doc = JSON.parse(serializeWorkspace({ datasets: [ds] })) as { datasets: unknown[] };
    expect(parseWorkspaceDataset(doc.datasets[0], 0).columnProps).toEqual(ds.columnProps);
  });
});
