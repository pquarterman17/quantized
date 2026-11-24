// The in-tool Statistical tests book maps a live table to the saved table it
// became (lane RB4): untitled and repeated titles, and tables the save omits.

import { describe, expect, it } from "vitest";

import type { AnalysisResult } from "../../../lib/analysisResult";
import type { TestOutput } from "../../../lib/statsTestsResults";
import { savedTableIndex, tableLabels } from "./statsTestsBookTables";

const OUTPUT: TestOutput = {
  sentence: "s",
  tables: [
    { columns: ["a"], rows: [[1]] },
    { title: "Groups", columns: ["g", "n"], rows: [["x", 1]] },
    { title: "Groups", columns: ["g", "n"], rows: [["y", 2]] },
    { title: "Wide", columns: Array.from({ length: 3 }, (_, i) => `c${i}`), rows: [] },
  ],
};

describe("statistical-test book table mapping", () => {
  it("labels untitled tables by position and repeated titles by occurrence", () => {
    expect(tableLabels(OUTPUT.tables)).toEqual(["Table 1", "Groups", "Groups (2)", "Wide"]);
  });

  it("never repeats a label (a real \"A (2)\" after two \"A\"s; an untitled \"Table 2\" next to a real one)", () => {
    const tables = (titles: (string | undefined)[]) => titles.map((title) => ({ ...(title ? { title } : {}), columns: ["c"], rows: [] }));
    expect(tableLabels(tables(["A", "A", "A (2)"]))).toEqual(["A", "A (2)", "A (2) (2)"]);
    expect(tableLabels(tables(["x", undefined, "Table 2"]))).toEqual(["x", "Table 2", "Table 2 (2)"]);
    for (const titles of [["A", "A", "A (2)"], ["x", undefined, "Table 2"], ["A", "A (2)", "A", "A"]]) {
      const labels = tableLabels(tables(titles));
      expect(new Set(labels).size).toBe(labels.length);
    }
  });

  it("finds the saved table of the same title, columns and occurrence, and none for an omitted table", () => {
    const labels = tableLabels(OUTPUT.tables);
    // The save omitted "Wide" and kept the rest in order.
    const saved = { tables: [OUTPUT.tables[0], OUTPUT.tables[1], OUTPUT.tables[2]] } as unknown as AnalysisResult;
    expect(labels.map((label) => savedTableIndex(OUTPUT, labels, label, saved))).toEqual([0, 1, 2, -1]);
    // If the first "Groups" was omitted, the second must not claim its slot.
    const shorter = { tables: [OUTPUT.tables[0], OUTPUT.tables[2]] } as unknown as AnalysisResult;
    expect(savedTableIndex(OUTPUT, labels, "Groups (2)", shorter)).toBe(-1);
  });
});
