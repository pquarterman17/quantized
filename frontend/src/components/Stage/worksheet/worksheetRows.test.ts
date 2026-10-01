// resolveWorksheetRows: the worksheet's filter/sort/exclusion view. The
// exclusion Set is built ONCE per call — it used to be rebuilt per row, which
// is O(rows × excluded) (~2.3 s at 100k rows with 1k excluded).

import { beforeEach, describe, expect, it, vi } from "vitest";

import { excludedSet } from "../../../lib/rowstate";
import type { Dataset } from "../../../lib/types";
import { compareSortKeys, resolveWorksheetRows } from "./worksheetRows";

vi.mock("../../../lib/rowstate", async (orig) => {
  const actual = await orig<typeof import("../../../lib/rowstate")>();
  return { ...actual, excludedSet: vi.fn(actual.excludedSet) };
});

const NO_RULES = { filterCol: "", filterOp: ">", filterV1: "", filterV2: "", sort: null };

function sheet(y: number[], excludedRows?: number[]): Dataset {
  return {
    id: "d1",
    name: "s.dat",
    data: {
      time: y.map((_, i) => i),
      values: y.map((v) => [v]),
      labels: ["y"],
      units: [""],
      metadata: {},
    },
    ...(excludedRows ? { excludedRows } : {}),
  };
}

beforeEach(() => vi.mocked(excludedSet).mockClear());

describe("resolveWorksheetRows", () => {
  it("drops excluded rows from the analysis set only", () => {
    const rows = resolveWorksheetRows(sheet([50, 10, 40, 20, 30], [1, 3]), NO_RULES);
    expect(rows.visible).toEqual([0, 1, 2, 3, 4]);
    expect(rows.analysis).toEqual([0, 2, 4]);
  });

  it("filters, sorts and excludes together", () => {
    const rules = { ...NO_RULES, filterCol: "0", filterOp: ">", filterV1: "15", sort: { col: 0, dir: 1 as const } };
    const rows = resolveWorksheetRows(sheet([50, 10, 40, 20, 30], [4]), rules);
    expect(rows.visible).toEqual([0, 2, 3, 4]);
    expect(rows.ordered).toEqual([3, 4, 2, 0]);
    expect(rows.analysis).toEqual([0, 2, 3]);
  });

  it("builds the exclusion set once per call, not once per row", () => {
    const y = Array.from({ length: 1000 }, (_, i) => i);
    resolveWorksheetRows(sheet(y, [5, 6]), NO_RULES);
    expect(excludedSet).toHaveBeenCalledTimes(1);
  });
});

// Large-data sort (1M x 6 audit): the comparator used to re-read both keys
// out of the row-major grid on every comparison — O(n log n) grid reads — and
// answered 1 for NaN-vs-NaN in BOTH orders, an inconsistent comparator whose
// result depends on the engine's sort internals. Keys are now extracted once.
describe("resolveWorksheetRows sort", () => {
  /** A sheet whose grid counts every row read. */
  function countingSheet(y: number[]): { ds: Dataset; reads: () => number } {
    const ds = sheet(y);
    let reads = 0;
    const rows = ds.data.values;
    ds.data = {
      ...ds.data,
      values: new Proxy(rows, {
        get(target, prop, receiver) {
          if (typeof prop === "string" && /^\d+$/.test(prop)) reads += 1;
          return Reflect.get(target, prop, receiver) as unknown;
        },
      }),
    };
    return { ds, reads: () => reads };
  }

  it("reads each row's sort key once: grid reads scale linearly with rows", () => {
    for (const n of [1_000, 4_000]) {
      const y = Array.from({ length: n }, (_, i) => (i * 7919) % n);
      const { ds, reads } = countingSheet(y);
      const rows = resolveWorksheetRows(ds, { ...NO_RULES, sort: { col: 0, dir: 1 } });
      expect(rows.ordered.map((r) => y[r])).toEqual([...y].sort((a, b) => a - b));
      expect(reads()).toBe(n);
    }
  });

  it("puts blank cells last in row order, in both directions, wherever they start", () => {
    const N = Number.NaN;
    const y = [N, 3, N, 1, N, 2, N, N, 5, N, 4, N];
    const blanks = [0, 2, 4, 6, 7, 9, 11];
    const asc = resolveWorksheetRows(sheet(y), { ...NO_RULES, sort: { col: 0, dir: 1 } }).ordered;
    const desc = resolveWorksheetRows(sheet(y), { ...NO_RULES, sort: { col: 0, dir: -1 } }).ordered;
    expect(asc).toEqual([3, 5, 1, 10, 8, ...blanks]);
    expect(desc).toEqual([8, 10, 1, 5, 3, ...blanks]);
  });

  // V8's TimSort happens to tolerate the old NaN/NaN answer, so no input order
  // reproduces it through Array.sort; the contract is pinned on the comparator.
  it("compares keys consistently: cmp(a, b) is -cmp(b, a) for every pair, blanks included", () => {
    const keys = [Number.NaN, Number.NEGATIVE_INFINITY, -1, 0, 2.5];
    for (const dir of [1, -1] as const) {
      for (const p of keys) {
        for (const q of keys) {
          expect(Math.sign(compareSortKeys(p, q, dir))).toBe(-Math.sign(compareSortKeys(q, p, dir)) || 0);
        }
        if (!Number.isNaN(p)) expect(compareSortKeys(Number.NaN, p, dir)).toBeGreaterThan(0); // blanks last
      }
      expect(compareSortKeys(Number.NaN, Number.NaN, dir)).toBe(0);
    }
  });

  it("keeps equal keys in row order whichever way it sorts", () => {
    const y = [2, 1, 2, 1, 2];
    const sorted = (dir: 1 | -1) => resolveWorksheetRows(sheet(y), { ...NO_RULES, sort: { col: 0, dir } }).ordered;
    expect(sorted(1)).toEqual([1, 3, 0, 2, 4]);
    expect(sorted(-1)).toEqual([0, 2, 4, 1, 3]);
  });
});
