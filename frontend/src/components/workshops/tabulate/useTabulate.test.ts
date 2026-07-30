import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { reportEmit } from "../../../lib/api";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { MAX_GROUP_COLS, useTabulate } from "./useTabulate";

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  reportEmit: vi.fn(),
}));

// 12 rows: channel 0 is a 2-level categorical grouping column (nominal fires at
// ≥12 samples / ≤8 levels), channel 1 is a second 3-level categorical column,
// channel 2 is the continuous value column.
const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  values: [
    [0, 0, 10],
    [0, 0, 12],
    [0, 1, 14],
    [0, 1, 16],
    [0, 2, 18],
    [0, 2, 20],
    [1, 0, 30],
    [1, 0, 32],
    [1, 1, 34],
    [1, 1, 36],
    [1, 2, 38],
    [1, 2, 40],
  ],
  labels: ["grp", "sub", "val"],
  units: ["", "", ""],
  metadata: { x_column_name: "T" },
};

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data: DATA }],
    activeId: "d1",
    status: "",
    reports: [],
  });
});

describe("useTabulate", () => {
  it("defaults to a single group-by (first categorical) and a single value (first continuous)", () => {
    const { result } = renderHook(() => useTabulate());
    expect(result.current.groupCols).toEqual([0]);
    expect(result.current.valueCols).toEqual([2]);
    expect(result.current.groupLabels).toEqual(["grp"]);
    expect(result.current.valueLabels).toEqual(["val"]);
    expect(result.current.groupIsCategorical).toBe(true);
    // legacy v1 six, checked by default.
    expect(result.current.statKeys).toEqual(["count", "mean", "sd", "min", "max", "median"]);
    expect(result.current.grandTotal).toBe(false);
  });

  it("summarizes the value column per group", () => {
    const { result } = renderHook(() => useTabulate());
    const rows = result.current.rows;
    expect(rows.map((r) => r.levels)).toEqual([[0], [1]]);
    expect(rows[0].values[0]).toMatchObject({ count: 6, mean: 15, min: 10, max: 20, median: 15 });
    expect(rows[1].values[0]).toMatchObject({ count: 6, mean: 35, min: 30, max: 40, median: 35 });
  });

  it("honors row exclusion (#50): excluded rows drop from the summary", () => {
    // exclude the first three rows of group 0 (values 10, 12, 14)
    useApp.setState({
      datasets: [{ id: "d1", name: "run.dat", data: DATA, excludedRows: [0, 1, 2] }],
      activeId: "d1",
    });
    const { result } = renderHook(() => useTabulate());
    const g0 = result.current.rows.find((r) => r.levels[0] === 0)!;
    expect(g0.values[0].count).toBe(3); // 16, 18, 20 remain
    expect(g0.values[0].mean).toBe(18);
    // group 1 untouched
    expect(result.current.rows.find((r) => r.levels[0] === 1)!.values[0].count).toBe(6);
  });

  it("re-tabulates when the group/value columns change", () => {
    const { result } = renderHook(() => useTabulate());
    // add-before-remove so the well never passes through empty (removeGroupCol
    // always keeps at least one column, reverting to the categorical default
    // when emptied — the same "never groupless" rule v1 had).
    act(() => result.current.addGroupCol(2)); // groupCols=[0,2]
    act(() => result.current.removeGroupCol(0)); // groupCols=[2] — group by the continuous column
    act(() => result.current.addValueCol(0)); // valueCols=[2,0]
    act(() => result.current.removeValueCol(2)); // valueCols=[0]
    expect(result.current.groupCols).toEqual([2]);
    expect(result.current.valueCols).toEqual([0]);
    // 12 distinct group keys → 12 single-row groups
    expect(result.current.rows).toHaveLength(12);
    expect(result.current.groupIsCategorical).toBe(false);
  });

  it("nests up to MAX_GROUP_COLS group columns, depth-first ascending", () => {
    const { result } = renderHook(() => useTabulate());
    act(() => result.current.addGroupCol(1)); // grp then sub
    expect(result.current.groupCols).toEqual([0, 1]);
    const rows = result.current.rows;
    expect(rows.map((r) => r.levels)).toEqual([
      [0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2],
    ]);
    expect(rows[0].values[0]).toMatchObject({ count: 2, mean: 11 }); // 10,12
  });

  it("caps nested group columns at MAX_GROUP_COLS and ignores a 4th distinct column", () => {
    const { result } = renderHook(() => useTabulate());
    act(() => {
      result.current.addGroupCol(1);
      result.current.addGroupCol(2); // now at the cap (grp, sub, val)
    });
    expect(result.current.groupCols).toHaveLength(MAX_GROUP_COLS);
    act(() => result.current.addGroupCol(-1)); // a genuine 4th distinct column (x/"T")
    expect(result.current.groupCols).toEqual([0, 1, 2]); // unchanged — cap held
  });

  it("moveGroupCol reorders the nesting (swaps depth, changes row order)", () => {
    const { result } = renderHook(() => useTabulate());
    act(() => result.current.addGroupCol(1));
    expect(result.current.groupCols).toEqual([0, 1]);
    act(() => result.current.moveGroupCol(1, -1));
    expect(result.current.groupCols).toEqual([1, 0]);
    // now nested sub-then-grp: sub=0 rows (grp 0,1) come before sub=1 rows
    expect(result.current.rows.map((r) => r.levels)).toEqual([
      [0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1],
    ]);
  });

  it("supports multiple value columns independently", () => {
    const { result } = renderHook(() => useTabulate());
    act(() => result.current.addValueCol(1)); // val + sub as value columns
    expect(result.current.valueCols).toEqual([2, 1]);
    const rows = result.current.rows;
    expect(rows[0].values[0].mean).toBe(15); // val, group 0
    expect(rows[0].values[1].mean).toBeCloseTo(1); // sub codes 0,0,1,1,2,2 -> mean 1
  });

  it("toggleStat adds/removes a stat while keeping catalog order", () => {
    const { result } = renderHook(() => useTabulate());
    act(() => result.current.toggleStat("sem"));
    expect(result.current.statKeys).toEqual(["count", "mean", "sd", "sem", "min", "max", "median"]);
    act(() => result.current.toggleStat("mean"));
    expect(result.current.statKeys).toEqual(["count", "sd", "sem", "min", "max", "median"]);
  });

  it("grandTotal appends a totals row spanning every finite value", () => {
    const { result } = renderHook(() => useTabulate());
    act(() => result.current.setGrandTotal(true));
    const rows = result.current.rows;
    expect(rows).toHaveLength(3);
    expect(rows[2].isTotal).toBe(true);
    expect(rows[2].values[0]).toMatchObject({ count: 12, sum: 300 }); // 10..20 + 30..40
  });

  it("exports the summary as a new dataset (group + stat columns, grand total excluded)", () => {
    const { result } = renderHook(() => useTabulate());
    act(() => result.current.setGrandTotal(true));
    act(() => result.current.exportDataset());
    const ds = useApp.getState().datasets;
    expect(ds).toHaveLength(2);
    const out = ds[1];
    expect(out.name).toBe("val by grp");
    expect(out.data.time).toEqual([0, 1]); // ordinal row index, grand total row excluded
    expect(out.data.labels).toEqual([
      "grp", "val count", "val mean", "val sd", "val min", "val max", "val median",
    ]);
    expect(out.data.metadata.x_column_name).toBe("row");
    // first data row: group code 0, then [count, mean, sd, min, max, median]
    expect(out.data.values[0].slice(0, 3)).toEqual([0, 6, 15]);
    expect(out.data.values[1][0]).toBe(1); // second row's group code
  });

  it("emits a TSV with resolved group labels (not ordinal codes) and clear stat headers", () => {
    const { result } = renderHook(() => useTabulate());
    const lines = result.current.toTSV().split("\n");
    expect(lines[0]).toBe("grp\tval count\tval mean\tval sd\tval min\tval max\tval median");
    expect(lines).toHaveLength(3); // header + 2 groups
    // no Origin text-label column present in this fixture, so labels fall
    // back to formatted numeric codes ("0"/"1") — never left as JS `0`/`1`
    // typed numbers mixed into the same TSV row as the stat cells changes
    // nothing textually here, but a text-labeled fixture (below) proves the
    // resolution path is actually exercised, not just numeric passthrough.
    expect(lines[1].startsWith("0\t6\t15")).toBe(true);
  });

  it("resolves an Origin text-label metadata column into the TSV instead of numeric codes", () => {
    const labeled: DataStruct = {
      ...DATA,
      metadata: {
        ...DATA.metadata,
        origin_text_columns: {
          A: DATA.values.map((row) => (row[0] === 0 ? "Control" : "Treated")),
        },
      },
    };
    useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: labeled }], activeId: "d1" });
    const { result } = renderHook(() => useTabulate());
    const lines = result.current.toTSV().split("\n");
    expect(lines[1].startsWith("Control\t")).toBe(true);
    expect(lines[2].startsWith("Treated\t")).toBe(true);
  });

  it("exposes the active dataset id for the ZoneWell drop-target guard", () => {
    const { result } = renderHook(() => useTabulate());
    expect(result.current.datasetId).toBe("d1");
  });

  it("removeGroupCol/removeValueCol revert to the auto-pick default when the last one is removed", () => {
    const { result } = renderHook(() => useTabulate());
    act(() => result.current.addGroupCol(2)); // groupCols=[0,2]
    act(() => result.current.removeGroupCol(0)); // groupCols=[2]
    expect(result.current.groupCols).toEqual([2]);
    act(() => result.current.removeGroupCol(2)); // last one removed -> reverts
    expect(result.current.groupCols).toEqual([0]); // back to the categorical default
    act(() => result.current.removeValueCol(2)); // last value col removed -> reverts
    expect(result.current.valueCols).toHaveLength(1); // reverted, not empty
  });

  it("toReport() emits a #36 stats_table report (one record per row) and adds it", async () => {
    vi.mocked(reportEmit).mockResolvedValue({ report: { title: "t", sections: [] } });
    const { result } = renderHook(() => useTabulate());
    await act(async () => {
      await result.current.toReport();
    });
    expect(reportEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "stats_table",
        title: "val by grp — run.dat",
        records: [
          expect.objectContaining({ grp: "0", "val count": 6, "val mean": 15 }),
          expect.objectContaining({ grp: "1", "val count": 6, "val mean": 35 }),
        ],
      }),
    );
    expect(useApp.getState().reports).toHaveLength(1);
    expect(useApp.getState().reports[0].datasetId).toBe("d1");
  });

  it("toReport() surfaces a failure instead of throwing", async () => {
    vi.mocked(reportEmit).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useTabulate());
    await act(async () => {
      await result.current.toReport();
    });
    expect(useApp.getState().reports).toHaveLength(0);
    expect(result.current.reportBusy).toBe(false);
  });
});
