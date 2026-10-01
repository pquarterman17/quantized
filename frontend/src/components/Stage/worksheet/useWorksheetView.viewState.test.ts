// useWorksheetView's per-dataset view state and the stats footer's requests.
//
// - Sort and filter are keyed by column INDEX, so they must reset on a dataset
//   switch: carried over, they empty the new sheet or silently filter a
//   different column (and skew Extract subset and the column stats with it).
// - The stats footer sends finite values only — a blank (NaN) cell goes over
//   the wire as null and the route rejects it — and debounces a burst of
//   edits into one round of requests.

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { copyText } from "../../../lib/clipboard";
import { statsDescriptive } from "../../../lib/api/statsDescriptive";
import { excludedSet } from "../../../lib/rowstate";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useWorksheetView } from "./useWorksheetView";

vi.mock("../../../lib/api/statsDescriptive", () => ({ statsDescriptive: vi.fn() }));
vi.mock("../../../lib/clipboard", async (orig) => ({
  ...(await orig<typeof import("../../../lib/clipboard")>()),
  copyText: vi.fn(async (_text: string): Promise<boolean> => true),
}));
vi.mock("../../../lib/rowstate", async (orig) => {
  const actual = await orig<typeof import("../../../lib/rowstate")>();
  return { ...actual, excludedSet: vi.fn(actual.excludedSet) };
});

function sheet(id: string, y: number[], extra: Partial<Dataset> = {}): Dataset {
  return {
    id,
    name: `${id}.dat`,
    data: {
      time: y.map((_, i) => i),
      values: y.map((v) => [v]),
      labels: ["y"],
      units: [""],
      metadata: {},
    },
    ...extra,
  };
}

const a = sheet("a", [50, 10, 40, 20, 30]);
const b = sheet("b", [1, 2, 3]);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(statsDescriptive).mockResolvedValue({ N: 1 });
  useApp.setState({ datasets: [a, b], activeId: "a", selection: null, worksheetSelections: {} });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("sort and filter reset on a dataset switch", () => {
  it("clears the sort, the filter column/operator and both filter values", () => {
    const { result, rerender } = renderHook(({ d }) => useWorksheetView(d), { initialProps: { d: a } });
    act(() => {
      result.current.setSort({ col: 0, dir: -1 });
      result.current.setFilterCol("0");
      result.current.setFilterOp("between");
      result.current.setFilterV1("25");
      result.current.setFilterV2("45");
    });
    expect(result.current.filtered).toEqual([2, 4]); // 40 and 30
    rerender({ d: b });
    expect(result.current.sort).toBeNull();
    expect([result.current.filterCol, result.current.filterOp]).toEqual(["", ">"]);
    expect([result.current.filterV1, result.current.filterV2]).toEqual(["", ""]);
    expect(result.current.order).toEqual([0, 1, 2]); // not zero rows
    expect(result.current.filterActive).toBe(false);
  });
});

// 1M x 6 audit: the sort was memoised on the whole Dataset, so an exclusion
// toggle or a rename re-sorted every row. Identity of `order` is the
// load-invariant proof that no sort ran.
describe("the sorted order", () => {
  it("is reused when the dataset changes but its data and rules do not", () => {
    const { result, rerender } = renderHook(({ d }) => useWorksheetView(d), { initialProps: { d: a } });
    act(() => result.current.setSort({ col: 0, dir: 1 }));
    const order = result.current.order;
    rerender({ d: { ...a, name: "renamed.dat", excludedRows: [1] } });
    expect(result.current.order).toBe(order);
    expect(result.current.analysisRows).toEqual([0, 2, 3, 4]); // exclusions still apply
    rerender({ d: { ...a, data: { ...a.data, values: [[5], [4], [3], [2], [1]] } } });
    expect(result.current.order).toEqual([4, 3, 2, 1, 0]); // a data change does re-sort
  });
});

describe("copyRows", () => {
  it("copies the sorted, non-excluded rows, building the exclusion set once", () => {
    const ds = sheet("a", [50, 10, 40, 20, 30], { excludedRows: [3] });
    useApp.setState({ datasets: [ds] });
    const { result } = renderHook(() => useWorksheetView(ds));
    act(() => result.current.setSort({ col: 0, dir: 1 }));
    vi.mocked(excludedSet).mockClear();
    result.current.copyRows();
    expect(excludedSet).toHaveBeenCalledTimes(1);
    const tsv = vi.mocked(copyText).mock.calls[0][0];
    expect(tsv.split("\n").slice(1)).toEqual(["1\t10", "4\t30", "2\t40", "0\t50"]);
  });
});

describe("the stats footer", () => {
  it("sends only finite values, so a blank cell does not fail the request", () => {
    vi.useFakeTimers();
    const ds = sheet("a", [1, Number.NaN, 3]);
    useApp.setState({ datasets: [ds] });
    const { result } = renderHook(() => useWorksheetView(ds));
    act(() => result.current.setShowStats(true));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(statsDescriptive).toHaveBeenCalledWith([1, 3]);
    expect(statsDescriptive).toHaveBeenCalledWith([0, 1, 2]); // x
  });

  it("debounces a burst of edits into one round of requests", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ d }) => useWorksheetView(d), { initialProps: { d: a } });
    act(() => result.current.setShowStats(true));
    rerender({ d: { ...a, data: { ...a.data, values: [[1], [2], [3], [4], [5]] } } });
    rerender({ d: { ...a, data: { ...a.data, values: [[6], [7], [8], [9], [10]] } } });
    expect(statsDescriptive).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(statsDescriptive).toHaveBeenCalledTimes(2); // x + y, once
    expect(statsDescriptive).toHaveBeenCalledWith([6, 7, 8, 9, 10]);
  });
});
