import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { reportEmit } from "../../../lib/api";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useTabulate } from "./useTabulate";

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  reportEmit: vi.fn(),
}));

// 12 rows: channel 0 is a 2-level categorical grouping column (nominal fires at
// ≥12 samples / ≤8 levels); channel 1 is the continuous value column.
const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  values: [
    [0, 10],
    [0, 12],
    [0, 14],
    [0, 16],
    [0, 18],
    [0, 20],
    [1, 30],
    [1, 32],
    [1, 34],
    [1, 36],
    [1, 38],
    [1, 40],
  ],
  labels: ["grp", "val"],
  units: ["", ""],
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
  it("defaults group-by to the categorical channel and value to a continuous one", () => {
    const { result } = renderHook(() => useTabulate());
    expect(result.current.groupCol).toBe(0);
    expect(result.current.valueCol).toBe(1);
    expect(result.current.groupLabel).toBe("grp");
    expect(result.current.valueLabel).toBe("val");
    expect(result.current.groupIsCategorical).toBe(true);
  });

  it("summarizes the value column per group", () => {
    const { result } = renderHook(() => useTabulate());
    const rows = result.current.rows;
    expect(rows.map((r) => r.group)).toEqual([0, 1]);
    expect(rows[0]).toMatchObject({ count: 6, mean: 15, min: 10, max: 20, median: 15 });
    expect(rows[1]).toMatchObject({ count: 6, mean: 35, min: 30, max: 40, median: 35 });
  });

  it("honors row exclusion (#50): excluded rows drop from the summary", () => {
    // exclude the first three rows of group 0 (values 10, 12, 14)
    useApp.setState({
      datasets: [{ id: "d1", name: "run.dat", data: DATA, excludedRows: [0, 1, 2] }],
      activeId: "d1",
    });
    const { result } = renderHook(() => useTabulate());
    const g0 = result.current.rows.find((r) => r.group === 0)!;
    expect(g0.count).toBe(3); // 16, 18, 20 remain
    expect(g0.mean).toBe(18);
    // group 1 untouched
    expect(result.current.rows.find((r) => r.group === 1)!.count).toBe(6);
  });

  it("re-tabulates when the group/value columns change", () => {
    const { result } = renderHook(() => useTabulate());
    act(() => {
      result.current.setGroupCol(1); // group by the continuous column
      result.current.setValueCol(0);
    });
    // 12 distinct group keys → 12 single-row groups
    expect(result.current.rows).toHaveLength(12);
    expect(result.current.groupIsCategorical).toBe(false);
  });

  it("exports the summary as a new dataset (group key → x, aggregates → channels)", () => {
    const { result } = renderHook(() => useTabulate());
    act(() => result.current.exportDataset());
    const ds = useApp.getState().datasets;
    expect(ds).toHaveLength(2);
    const out = ds[1];
    expect(out.name).toBe("val by grp");
    expect(out.data.time).toEqual([0, 1]); // the two group keys
    expect(out.data.labels).toEqual([
      "val count", "val mean", "val sd", "val min", "val max", "val median",
    ]);
    expect(out.data.metadata.x_column_name).toBe("grp");
    // first row's aggregates: [count, mean, sd, min, max, median] for group 0
    expect(out.data.values[0].slice(0, 2)).toEqual([6, 15]);
  });

  it("emits a TSV with a header and one line per group", () => {
    const { result } = renderHook(() => useTabulate());
    const lines = result.current.toTSV().split("\n");
    expect(lines[0]).toBe("grp\tcount\tmean\tsd\tmin\tmax\tmedian");
    expect(lines).toHaveLength(3); // header + 2 groups
    expect(lines[1].startsWith("0\t6\t15")).toBe(true);
  });

  it("exposes the active dataset id for the ZoneWell drop-target guard", () => {
    const { result } = renderHook(() => useTabulate());
    expect(result.current.datasetId).toBe("d1");
  });

  it("removeGroupCol/removeValueCol revert to the auto-pick default", () => {
    const { result } = renderHook(() => useTabulate());
    act(() => {
      result.current.setGroupCol(1);
      result.current.setValueCol(0);
    });
    expect(result.current.groupCol).toBe(1);
    act(() => result.current.removeGroupCol());
    expect(result.current.groupCol).toBe(0); // back to the categorical default
    act(() => result.current.removeValueCol());
    expect(result.current.valueCol).toBe(1); // back to the continuous default
  });

  it("toReport() emits a #36 stats_table report (one record per group) and adds it", async () => {
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
          expect.objectContaining({ group: 0, count: 6, mean: 15, min: 10, max: 20, median: 15 }),
          expect.objectContaining({ group: 1, count: 6, mean: 35, min: 30, max: 40, median: 35 }),
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
