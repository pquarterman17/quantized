import { describe, expect, it, vi } from "vitest";

import { computeSelectionStats, formatSelectionStats, memoSelectionStats, worthShowing } from "./selectionStats";

const grid = [
  [1, 2, 3],
  [4, Number.NaN, 6],
  [7, 8, 9],
];
const valueAt = (r: number, c: number) => grid[r]?.[c];

describe("computeSelectionStats", () => {
  it("counts, sums, averages and bounds the numeric cells", () => {
    const s = computeSelectionStats({ rows: [0, 1, 2], cols: [0, 1, 2], valueAt })!;
    expect(s).toMatchObject({ count: 8, sum: 40, mean: 5, min: 1, max: 9, text: 0, skipped: 0, cells: 9 });
  });
  it("ignores blank / NaN / non-number cells", () => {
    const s = computeSelectionStats({ rows: [1], cols: [0, 1, 2], valueAt })!;
    expect(s.count).toBe(2);
    expect(computeSelectionStats({ rows: [0], cols: [0], valueAt: () => "x" })).toBeNull();
    expect(computeSelectionStats({ rows: [], cols: [0], valueAt })).toBeNull();
  });
  it("counts text columns separately and never sums them", () => {
    const s = computeSelectionStats({ rows: [0, 1], cols: [0, 1], valueAt, isTextCol: (c) => c === 1 })!;
    expect(s).toMatchObject({ count: 2, sum: 5, text: 2, cells: 4 });
  });
  it("skips excluded rows and says how many cells", () => {
    const s = computeSelectionStats({ rows: [0, 1, 2], cols: [0], valueAt, isSkippedRow: (r) => r === 2 })!;
    expect(s).toMatchObject({ count: 2, sum: 5, skipped: 1 });
    expect(formatSelectionStats(s, (_k, v) => String(v))).toContain("1 excluded skipped");
  });
  it("sums without drift (compensated)", () => {
    const n = 100000;
    const s = computeSelectionStats({ rows: Array.from({ length: n }, (_, i) => i), cols: [0], valueAt: () => 0.1 })!;
    expect(s.sum).toBeCloseTo(10000, 9);
  });
  it("hides a single cell", () => {
    expect(worthShowing(computeSelectionStats({ rows: [0], cols: [0], valueAt }))).toBe(false);
    expect(worthShowing(null)).toBe(false);
    expect(worthShowing(computeSelectionStats({ rows: [0, 1], cols: [0], valueAt }))).toBe(true);
  });
});

describe("memoSelectionStats", () => {
  it("does not touch a cell again for the same selection and data identity", () => {
    const m = memoSelectionStats();
    const read = vi.fn(valueAt);
    const rows = new Set([0, 1]);
    const cols = new Set([0]);
    const a = m([rows, cols, grid], () => ({ rows, cols, valueAt: read }));
    const calls = read.mock.calls.length;
    const b = m([rows, cols, grid], () => ({ rows, cols, valueAt: read }));
    expect(b).toBe(a);
    expect(read.mock.calls.length).toBe(calls);
    m([new Set([0, 1]), cols, grid], () => ({ rows, cols, valueAt: read }));
    expect(read.mock.calls.length).toBeGreaterThan(calls);
  });
});
