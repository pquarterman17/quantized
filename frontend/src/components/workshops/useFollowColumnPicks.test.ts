// A workshop's column pick follows its column by label when the active
// dataset's columns change under it, or resets with one notice when the
// column is gone (./useFollowColumnPicks.ts). Covers four workshop hooks; the
// Outlier Screening "follows" case lives in store/crossRefOpenGaps.test.ts.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ComputedColumn, DataStruct } from "../../lib/types";
import { toast } from "../../store/toasts";
import { useApp } from "../../store/useApp";
import { useDistribution } from "./distribution/useDistribution";
import { useFitYByX } from "./fityx/useFitYByX";
import { useOutlierScreening } from "./outliers/useOutlierScreening";
import { useStatsChooser } from "./statschooser/useStatsChooser";
import { followColumn } from "./useFollowColumnPicks";
import { useVariability } from "./variability/useVariability";

// Every hook auto-runs its analysis; never let one settle.
vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(
    Object.entries(real).map(([k, v]) => [k, typeof v === "function" && k.startsWith("stats") ? vi.fn(() => new Promise(() => {})) : v]),
  );
});
vi.mock("../../lib/api/statsDescriptive", () => ({ statsDescriptive: vi.fn(() => new Promise(() => {})) }));
vi.mock("../../store/toasts", () => ({ toast: vi.fn() }));

const formulas: ComputedColumn[] = [
  { name: "F1", expr: "A * 1", deps: ["A"] },
  { name: "F2", expr: "A * 2", deps: ["A"] },
  { name: "F3", expr: "A * 3", deps: ["A"] },
];
const rows = [1, 2, 3, 4, 5, 6].map((a) => [a, a, 2 * a, 3 * a]);
const data = (labels: string[], values: number[][]): DataStruct => ({
  time: values.map((_, i) => i),
  values,
  labels,
  units: labels.map(() => ""),
  metadata: {},
});

const labelOf = (i: number) => useApp.getState().datasets[0].data.labels[i];
const removeF1 = () => act(() => useApp.getState().removeFormula("a", 0));

beforeEach(() => {
  vi.mocked(toast).mockClear();
  useApp.setState({
    datasets: [{ id: "a", name: "a", data: data(["A", "F1", "F2", "F3"], rows), formulas }],
    activeId: "a",
    plotWindows: [],
    editableFigures: [],
    figureDocs: [],
    savedPlotSpecs: [],
  });
});

describe("followColumn", () => {
  it("follows a label, keeps a rename, and refuses to guess", () => {
    expect(followColumn(["A", "B", "C"], ["A", "C"], 2)).toBe(1); // a removal
    expect(followColumn(["A", "B"], ["N", "A", "B"], 1)).toBe(2); // an insertion
    expect(followColumn(["A", "B"], ["A", "Z"], 1)).toBe(1); // an in-place rename
    expect(followColumn(["A", "B", "C"], ["A", "C"], 1)).toBeNull(); // gone
    expect(followColumn(["A", "B", "B"], ["A", "B"], 2)).toBeNull(); // which B?
    expect(followColumn(["A"], [], -1)).toBe(-1); // the time axis
  });
});

describe("a workshop pick when a column is removed or added under it", () => {
  it("Distribution keeps profiling F2", () => {
    const { result } = renderHook(() => useDistribution());
    act(() => result.current.setCol(2));
    removeF1();
    expect(labelOf(result.current.col)).toBe("F2");
  });

  it("Fit Y by X keeps Y on F3 and X on F2", () => {
    const { result } = renderHook(() => useFitYByX());
    act(() => {
      result.current.setXCol(2);
      result.current.setYCol(3);
    });
    removeF1();
    expect([labelOf(result.current.xCol), labelOf(result.current.yCol)]).toEqual(["F2", "F3"]);
  });

  it("Stats Chooser keeps its picked columns and Variability its response", () => {
    const chooser = renderHook(() => useStatsChooser());
    const variability = renderHook(() => useVariability());
    act(() => {
      chooser.result.current.toggleCol(0); // start from an empty pick
      chooser.result.current.toggleCol(2);
      chooser.result.current.toggleCol(3);
      variability.result.current.setResponseCol(2);
    });
    removeF1();
    expect(chooser.result.current.cols.map(labelOf)).toEqual(["F2", "F3"]);
    expect(labelOf(variability.result.current.responseCol)).toBe("F2");
  });

  it("Distribution follows its column past an inserted one", () => {
    const { result } = renderHook(() => useDistribution());
    act(() => result.current.setCol(1)); // F1
    act(() =>
      useApp.setState((s) => ({
        datasets: s.datasets.map((d) => ({ ...d, formulas: undefined, data: data(["N", "A", "F1"], rows.map((r) => [0, r[0], r[1]])) })),
      })),
    );
    expect(labelOf(result.current.col)).toBe("F1");
    expect(toast).not.toHaveBeenCalled();
  });

  it("a pick on the removed column resets with one notice", () => {
    const { result } = renderHook(() => useOutlierScreening());
    act(() => result.current.setCol(1)); // F1
    removeF1();
    expect(result.current.col).toBe(0); // the default pick
    expect(toast).toHaveBeenCalledWith('Column "F1" is gone, so its pick was reset.', "info");
  });
});
