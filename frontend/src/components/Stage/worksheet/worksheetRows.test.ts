// resolveWorksheetRows: the worksheet's filter/sort/exclusion view. The
// exclusion Set is built ONCE per call — it used to be rebuilt per row, which
// is O(rows × excluded) (~2.3 s at 100k rows with 1k excluded).

import { beforeEach, describe, expect, it, vi } from "vitest";

import { excludedSet } from "../../../lib/rowstate";
import type { Dataset } from "../../../lib/types";
import { resolveWorksheetRows } from "./worksheetRows";

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
