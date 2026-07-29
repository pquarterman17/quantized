import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Dataset, DataStruct } from "../../lib/types";
import { useByPartition } from "./useByPartition";

const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  values: [
    [0, 10], [0, 12], [0, 14], [0, 16],
    [1, 20], [1, 22], [1, 24], [1, 26],
    [2, 30], [2, 32], [2, 34], [2, 36],
  ],
  labels: ["grp", "val"],
  units: ["", "K"],
  metadata: {},
};

const ACTIVE: Dataset = { id: "d1", name: "run.dat", data: DATA };
const COLUMNS = [{ index: -1, label: "T" }, { index: 0, label: "grp" }, { index: 1, label: "val" }];

describe("useByPartition", () => {
  it("no By selected by default: empty levels, byOptions excludes x and continuous channels", () => {
    const { result } = renderHook(() => useByPartition(ACTIVE, DATA, COLUMNS));
    expect(result.current.byCol).toBeNull();
    expect(result.current.levels).toEqual([]);
    expect(result.current.byOptions).toEqual([{ index: 0, label: "grp" }]);
  });

  it("picking a By column partitions the data into per-level sections", () => {
    const { result } = renderHook(() => useByPartition(ACTIVE, DATA, COLUMNS));
    act(() => result.current.setByCol(0));
    expect(result.current.byCol).toBe(0);
    expect(result.current.levels).toHaveLength(3);
    expect(result.current.levels.map((l) => l.rowIndexes.length)).toEqual([4, 4, 4]);
  });

  it("switching the active dataset resets the By column (a stale index may mean something else there)", () => {
    const { result, rerender } = renderHook(({ active }) => useByPartition(active, DATA, COLUMNS), {
      initialProps: { active: ACTIVE },
    });
    act(() => result.current.setByCol(0));
    expect(result.current.byCol).toBe(0);
    const OTHER: Dataset = { id: "d2", name: "other.dat", data: DATA };
    rerender({ active: OTHER });
    expect(result.current.byCol).toBeNull();
    expect(result.current.levels).toEqual([]);
  });

  it("returns no options and no levels with no active dataset", () => {
    const { result } = renderHook(() => useByPartition(null, null, COLUMNS));
    expect(result.current.byOptions).toEqual([]);
    expect(result.current.levels).toEqual([]);
  });
});
