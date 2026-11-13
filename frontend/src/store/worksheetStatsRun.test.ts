// Worksheet audit #19: Row statistics (computed columns across columns, one
// undo step) and Frequency count (a binned table as a new worksheet).

import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyFormulas } from "../lib/formula";
import "../lib/formulaRefs"; // registers rowmean() & co. (lib/formulaExt.ts)
import { frequencyTable } from "../lib/frequencyCount";
import type { Dataset } from "../lib/types";
import { useApp } from "./useApp";

const { askParamsMock } = vi.hoisted(() => ({ askParamsMock: vi.fn() }));
vi.mock("./paramDialog", () => ({ askParams: askParamsMock }));

import { runFrequencyCount, runRowStatistics } from "./worksheetStatsRun";

const sheet: Dataset = {
  id: "w",
  name: "scan",
  data: {
    time: [1, 2, 3, 4],
    values: [
      [1, 3, 0.1],
      [2, Number.NaN, 0.1],
      [3, 5, 0.1],
      [10, 20, 0.1],
    ],
    labels: ["M1", "M2", "dM"],
    units: ["emu", "emu", "emu"],
    metadata: { x_column_name: "T", x_column_unit: "K" },
  },
  errorRoles: [{ channel: 2, target: 0, axis: "y", side: "both" }],
};

beforeEach(() => {
  askParamsMock.mockReset();
  useApp.setState({ datasets: [sheet], activeId: "w", history: [], future: [], status: "" });
});

describe("row functions", () => {
  it("skip blank cells; rowsd is the sample SD; rown counts", () => {
    const out = applyFormulas(sheet.data, [
      { name: "m", expr: "rowmean(A, B)" },
      { name: "s", expr: "rowsd(A, B)" },
      { name: "n", expr: "rown(A, B)" },
      { name: "lo", expr: "rowmin(A, B)" },
      { name: "sum", expr: "rowsum(A, B)" },
    ]);
    expect(out.values.map((r) => r.slice(3))).toEqual([
      [2, Math.SQRT2, 2, 1, 4],
      [2, Number.NaN, 1, 2, 2],
      [4, Math.SQRT2, 2, 3, 8],
      [15, Math.sqrt(50), 2, 10, 30],
    ]);
  });
});

describe("Row statistics", () => {
  it("adds the ticked statistics as computed columns in ONE undo step, with the shared unit", async () => {
    askParamsMock.mockResolvedValue({ "col:0": true, "col:1": true, mean: true, sd: false, min: false, max: true, sum: false, n: true });
    await runRowStatistics();
    const d = useApp.getState().datasets[0];
    expect(d.formulas).toEqual([
      { name: "Row mean", expr: "rowmean(A, B)", deps: ["A", "B"], unit: "emu" },
      { name: "Row max", expr: "rowmax(A, B)", deps: ["A", "B"], unit: "emu" },
      { name: "Row N", expr: "rown(A, B)", deps: ["A", "B"] },
    ]);
    expect(d.data.values[3].slice(3)).toEqual([15, 20, 2]);
    expect(useApp.getState().history).toHaveLength(1);
    useApp.getState().undo();
    expect(useApp.getState().datasets[0].formulas).toBeUndefined();
  });

  it("offers a checkbox per numeric value column (named by letter, label, unit), never the error column", async () => {
    askParamsMock.mockResolvedValue({ "col:0": true, mean: true });
    await runRowStatistics();
    const fields = askParamsMock.mock.calls[0][1] as { key: string; label: string; type: string; default: unknown }[];
    const columns = fields.filter((f) => f.key.startsWith("col:"));
    expect(columns).toEqual([
      { key: "col:0", label: "A: M1 (emu)", type: "boolean", default: true },
      { key: "col:1", label: "B: M2 (emu)", type: "boolean", default: true },
    ]);
    expect(new Set(fields.map((f) => f.label)).size).toBe(fields.length); // unique accessible names
    // One ticked column is not enough, and nothing changes.
    expect(useApp.getState().status).toMatch(/tick at least two columns/);
    expect(useApp.getState().datasets[0].formulas).toBeUndefined();
  });
});

describe("Frequency count", () => {
  it("bins into equal-width [lo, hi) bins with the last bin closed, and reports blanks/outside values", () => {
    const t = frequencyTable([0, 1, 2, 3, 4, Number.NaN, 9], { bins: 2, min: 0, max: 4 });
    expect(t.lo).toEqual([0, 2]);
    expect(t.hi).toEqual([2, 4]);
    expect(t.centers).toEqual([1, 3]);
    expect(t.counts).toEqual([2, 3]); // 4 (= max) lands in the last bin
    expect(t.cumulative).toEqual([2, 5]);
    expect(t.percent).toEqual([40, 60]);
    expect(t.cumulativePercent).toEqual([40, 100]);
    expect([t.missing, t.outside]).toEqual([1, 1]);
    expect(frequencyTable([0, 10], { width: 3 }).counts).toEqual([1, 0, 0, 1]); // ceil(10/3) bins
  });

  it("fuzz: recounting by the table's own published edges always reproduces its counts (grid-aligned values)", () => {
    let seed = 12345;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let trial = 0; trial < 3000; trial++) {
      const n = 2 + Math.floor(rand() * 30);
      const lo = Math.round((rand() - 0.5) * 2000) / 10;
      const width = [0.1, 0.2, 0.3, 0.7, 1.1, 0.01, 2.5][Math.floor(rand() * 7)];
      // Values ON the bin grid, where floor((v - lo) / width) is off by one ulp.
      const values = Array.from({ length: n + 1 }, (_, i) => lo + i * width);
      const t = frequencyTable(values, { width, min: lo, max: lo + n * width });
      const recount = t.lo.map((l, i) => values.filter((v) => v >= l && (i === t.lo.length - 1 ? v <= t.hi[i] : v < t.hi[i])).length);
      expect(t.counts).toEqual(recount);
      expect(t.counted + t.outside).toBe(values.length);
    }
  });

  it("creates a new worksheet in the source's book from the analysis rows", async () => {
    useApp.setState({ datasets: [{ ...sheet, workbookId: "B", excludedRows: [3] }] });
    askParamsMock.mockResolvedValue({ column: "A: M1", bins: "2", width: "", min: "", max: "" });
    await runFrequencyCount();
    const out = useApp.getState().datasets.at(-1)!;
    expect(out.name).toBe("scan — frequency of M1");
    expect(out.workbookId).toBe("B");
    expect(useApp.getState().activeId).toBe(out.id);
    expect(out.data.labels).toEqual(["Bin start", "Bin end", "Count", "Cumulative count", "Percent", "Cumulative percent"]);
    expect(out.data.units).toEqual(["emu", "emu", "", "", "%", "%"]);
    expect(out.data.values.map((r) => r[2])).toEqual([1, 2]); // row 4 (10) is excluded
    expect(out.data.metadata.x_column_name).toBe("Bin center");
  });

  it("says why a bad entry is refused, adding nothing", async () => {
    askParamsMock.mockResolvedValue({ column: "A: M1", bins: "two", width: "", min: "", max: "" });
    await runFrequencyCount();
    expect(useApp.getState().datasets).toHaveLength(1);
    expect(useApp.getState().status).toMatch(/the number of bins must be a number \(got "two"\)/);
  });
});
