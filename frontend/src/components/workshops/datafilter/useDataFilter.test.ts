import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useDataFilter } from "./useDataFilter";

// 12 rows: channel 0 is a 2-level categorical column; channel 1 is continuous.
const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  values: [
    [0, 10], [0, 12], [0, 14], [0, 16], [0, 18], [0, 20],
    [1, 30], [1, 32], [1, 34], [1, 36], [1, 38], [1, 40],
  ],
  labels: ["grp", "val"],
  units: ["", ""],
  metadata: { x_column_name: "T" },
};

const filterOf = (id: string) => useApp.getState().datasets.find((d) => d.id === id)?.filter;

beforeEach(() => {
  useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: DATA }], activeId: "d1" });
});

describe("useDataFilter", () => {
  it("classifies columns: x + continuous → range, categorical → set with levels", () => {
    const { result } = renderHook(() => useDataFilter());
    const cols = result.current.columns;
    expect(cols.map((c) => c.index)).toEqual([-1, 0, 1]);
    expect(cols[0]).toMatchObject({ index: -1, kind: "range" }); // x
    expect(cols[1]).toMatchObject({ index: 0, kind: "set" }); // grp (categorical)
    expect(cols[1].levels).toEqual([0, 1]);
    expect(cols[2]).toMatchObject({ index: 1, kind: "range" }); // val (continuous)
  });

  it("setRange writes a range predicate and updates the kept count", () => {
    const { result } = renderHook(() => useDataFilter());
    act(() => result.current.setRange(1, 15, undefined)); // val ≥ 15
    expect(filterOf("d1")).toEqual([{ col: 1, kind: "range", min: 15 }]);
    // values 10,12,14 drop → 9 of 12 kept
    expect(result.current.kept).toBe(9);
    expect(result.current.total).toBe(12);
    expect(result.current.active).toBe(true);
  });

  it("toggleLevel narrows a categorical column to the checked levels", () => {
    const { result } = renderHook(() => useDataFilter());
    act(() => result.current.toggleLevel(0, 1)); // uncheck level 1 → keep {0}
    expect(filterOf("d1")).toEqual([{ col: 0, kind: "set", values: [0] }]);
    expect(result.current.kept).toBe(6); // only the six grp=0 rows
  });

  it("dropping the predicate when all levels are re-checked", () => {
    const { result } = renderHook(() => useDataFilter());
    act(() => result.current.toggleLevel(0, 1)); // keep {0}
    act(() => result.current.toggleLevel(0, 1)); // re-check 1 → all levels → no constraint
    expect(filterOf("d1")).toBeUndefined();
    expect(result.current.active).toBe(false);
  });

  it("clear removes the filter", () => {
    const { result } = renderHook(() => useDataFilter());
    act(() => result.current.setRange(1, 15, 35));
    expect(filterOf("d1")).toBeTruthy();
    act(() => result.current.clear());
    expect(filterOf("d1")).toBeUndefined();
    expect(result.current.kept).toBe(12);
  });

  it("an open range (no bounds) writes no predicate", () => {
    const { result } = renderHook(() => useDataFilter());
    act(() => result.current.setRange(1, undefined, undefined));
    expect(filterOf("d1")).toBeUndefined();
  });
});
