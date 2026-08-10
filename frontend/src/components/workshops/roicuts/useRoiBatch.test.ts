import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { rsmBoxCut, rsmBoxStats, type BoxStats } from "../../../lib/api/rsm";
import { plotSelectedTogether } from "../../../lib/plotSelectedTogether";
import type { RoiRect } from "../../../lib/roi";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import {
  batchEligibility,
  buildBatchSummaryDataStruct,
  summaryToCsv,
  useRoiBatch,
  type BatchSummaryRow,
} from "./useRoiBatch";

vi.mock("../../../lib/api/rsm", () => ({
  rsmBoxCut: vi.fn(),
  rsmBoxStats: vi.fn(),
}));

vi.mock("../../../lib/plotSelectedTogether", () => ({
  plotSelectedTogether: vi.fn(),
}));

// Two eligible 2-D angular maps — same shape as useRoiCuts.test.ts's NONE_DS
// (no Qx/Qz), which is exactly what makes them ELIGIBLE for an "angular"
// space ROI: angular is always available on any is2D dataset (its two axis
// columns are labels[0]/labels[1]).
function angularMap(): DataStruct {
  return {
    time: [0, 1, 2, 3],
    values: [
      [60, 30, 100],
      [61, 30, 200],
      [60, 31, 150],
      [61, 31, 300],
    ],
    labels: ["2Theta", "Omega", "Intensity"],
    units: ["deg", "deg", "cps"],
    metadata: { is2D: true, map_shape: [2, 2], axis1_name: "Omega" },
  };
}

// Carries Qx/Qz — eligible for a "q"-space ROI too.
function qMap(): DataStruct {
  return {
    ...angularMap(),
    values: [
      [60, 30, 100, 0.5, 4.0],
      [61, 30, 200, 0.45, 3.9],
      [60, 31, 150, 0.4, 4.1],
      [61, 31, 300, 0.42, 3.8],
    ],
    labels: ["2Theta", "Omega", "Intensity", "Qx", "Qz"],
    units: ["deg", "deg", "cps", "Ang^-1", "Ang^-1"],
  };
}

// A plain 1-D dataset — never a 2-D map, always ineligible.
const NOT_MAP: DataStruct = {
  time: [0, 1, 2],
  values: [[1], [2], [3]],
  labels: ["Y"],
  units: ["cps"],
  metadata: {},
};

const RECT: RoiRect = { space: "angular", x0: 0, x1: 10, y0: 0, y1: 10 };
const Q_RECT: RoiRect = { space: "q", x0: -1, x1: 1, y0: 3, y1: 5 };

const CUT_RESULT: DataStruct = {
  time: [0, 1],
  values: [
    [0.5, 10],
    [0.6, 12],
  ],
  labels: ["Intensity", "N points"],
  units: ["cps", ""],
  metadata: { cut_label: "box cut" },
};

function stats(overrides: Partial<BoxStats> = {}): BoxStats {
  return {
    n_points: 4,
    integrated_intensity: 42,
    mean_intensity: 10.5,
    max_intensity: 20,
    peak_x: 1,
    peak_y: 2,
    centroid_x: 1.1,
    centroid_y: 2.2,
    x_min: 0,
    x_max: 10,
    y_min: 0,
    y_max: 10,
    space: "angular",
    angle: 0,
    wrap: null,
    ...overrides,
  };
}

function setLibrary(entries: { id: string; name: string; data: DataStruct }[], selectedIds: string[]): void {
  useApp.setState({ datasets: entries, selectedIds, activeId: entries[0]?.id ?? null });
}

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ mapRoi: null, mapRuler: null, savedRois: [], selectedIds: [], datasets: [] });
  vi.mocked(rsmBoxCut).mockResolvedValue(CUT_RESULT);
  vi.mocked(rsmBoxStats).mockResolvedValue(stats());
  vi.mocked(plotSelectedTogether).mockResolvedValue(undefined);
});

describe("batchEligibility", () => {
  it("rejects a non-2D dataset", () => {
    expect(batchEligibility(NOT_MAP, RECT)).toMatch(/not a 2-D map/);
  });

  it("rejects a Q-space ROI against a dataset with no Qx/Qz", () => {
    expect(batchEligibility(angularMap(), Q_RECT)).toMatch(/Qx\/Qz/);
  });

  it("accepts an angular ROI against any 2-D map", () => {
    expect(batchEligibility(angularMap(), RECT)).toBeNull();
  });

  it("accepts a Q-space ROI against a dataset that carries Qx/Qz", () => {
    expect(batchEligibility(qMap(), Q_RECT)).toBeNull();
  });
});

describe("buildBatchSummaryDataStruct / summaryToCsv", () => {
  const rows: BatchSummaryRow[] = [
    { name: "alpha", stats: stats({ integrated_intensity: 10, n_points: 4 }) },
    { name: "beta", stats: stats({ integrated_intensity: 20, n_points: 8 }) },
  ];

  it("has one row per dataset with the expected columns", () => {
    const ds = buildBatchSummaryDataStruct(rows);
    expect(ds.labels).toEqual([
      "Integrated Intensity",
      "Centroid X",
      "Centroid Y",
      "Peak X",
      "Peak Y",
      "Max Intensity",
      "N points",
    ]);
    expect(ds.values).toHaveLength(2);
    expect(ds.values[0]).toEqual([10, 1.1, 2.2, 1, 2, 20, 4]);
    expect(ds.values[1][0]).toBe(20);
    expect(ds.metadata["origin_text_columns"]).toEqual({ Dataset: ["alpha", "beta"] });
    expect(ds.metadata["x_column_name"]).toBe("Dataset");
  });

  it("emits a well-formed CSV with a header and one line per row", () => {
    const csv = summaryToCsv(rows);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("dataset,integrated_intensity,centroid_x,centroid_y,peak_x,peak_y,max_intensity,n_points");
    expect(lines[1]).toBe("alpha,10,1.1,2.2,1,2,20,4");
    expect(lines[2]).toBe("beta,20,1.1,2.2,1,2,20,8");
  });

  it("quotes a dataset name that contains a comma", () => {
    const csv = summaryToCsv([{ name: "a, b", stats: stats() }]);
    expect(csv.split("\n")[1]?.startsWith('"a, b",')).toBe(true);
  });
});

describe("useRoiBatch — applyToSelected", () => {
  it("lands one cut per eligible dataset with '<dataset>: '-prefixed names", async () => {
    setLibrary(
      [
        { id: "a", name: "alpha", data: angularMap() },
        { id: "b", name: "beta", data: angularMap() },
      ],
      ["a", "b"],
    );
    const { result } = renderHook(() => useRoiBatch());

    await act(async () => {
      await result.current.applyToSelected(RECT);
    });

    const names = useApp.getState().datasets.map((d) => d.name);
    expect(names).toEqual(expect.arrayContaining(["alpha: box cut", "beta: box cut"]));
    expect(result.current.outcome?.appliedCount).toBe(2);
    expect(result.current.outcome?.newIds).toHaveLength(2);
    expect(rsmBoxCut).toHaveBeenCalledTimes(2);
  });

  it("skips ineligible datasets and counts them, naming the reason", async () => {
    setLibrary(
      [
        { id: "a", name: "alpha", data: angularMap() },
        { id: "b", name: "not a map", data: NOT_MAP },
      ],
      ["a", "b"],
    );
    const { result } = renderHook(() => useRoiBatch());

    await act(async () => {
      await result.current.applyToSelected(RECT);
    });

    expect(result.current.outcome?.appliedCount).toBe(1);
    expect(result.current.outcome?.skipped).toEqual([{ name: "not a map", reason: expect.stringMatching(/not a 2-D map/) }]);
    expect(rsmBoxCut).toHaveBeenCalledTimes(1);
  });

  it("a mid-batch cut failure is recorded and does not abort the rest", async () => {
    setLibrary(
      [
        { id: "a", name: "alpha", data: angularMap() },
        { id: "b", name: "beta", data: angularMap() },
        { id: "c", name: "gamma", data: angularMap() },
      ],
      ["a", "b", "c"],
    );
    vi.mocked(rsmBoxCut)
      .mockResolvedValueOnce(CUT_RESULT)
      .mockRejectedValueOnce(new Error("backend exploded"))
      .mockResolvedValueOnce(CUT_RESULT);
    const { result } = renderHook(() => useRoiBatch());

    await act(async () => {
      await result.current.applyToSelected(RECT);
    });

    expect(rsmBoxCut).toHaveBeenCalledTimes(3);
    expect(result.current.outcome?.appliedCount).toBe(2);
    expect(result.current.outcome?.errored).toEqual([{ name: "beta", reason: "backend exploded" }]);
    // library still has BOTH successful cuts — the library is never left
    // half-populated by a mid-batch failure.
    const names = useApp.getState().datasets.map((d) => d.name);
    expect(names).toEqual(expect.arrayContaining(["alpha: box cut", "gamma: box cut"]));
  });

  it("'plot together' calls plotSelectedTogether with exactly the new ids", async () => {
    setLibrary(
      [
        { id: "a", name: "alpha", data: angularMap() },
        { id: "b", name: "beta", data: angularMap() },
      ],
      ["a", "b"],
    );
    const { result } = renderHook(() => useRoiBatch());
    expect(result.current.plotTogether).toBe(true); // default ON

    await act(async () => {
      await result.current.applyToSelected(RECT);
    });

    expect(plotSelectedTogether).toHaveBeenCalledTimes(1);
    const calledWith = vi.mocked(plotSelectedTogether).mock.calls[0]?.[0];
    expect(calledWith).toEqual(result.current.outcome?.newIds);
    expect(calledWith).toHaveLength(2);
  });

  it("does not call plotSelectedTogether when only one cut landed (its own >=2 gate)", async () => {
    setLibrary([{ id: "a", name: "alpha", data: angularMap() }], ["a"]);
    const { result } = renderHook(() => useRoiBatch());

    await act(async () => {
      await result.current.applyToSelected(RECT);
    });

    expect(plotSelectedTogether).not.toHaveBeenCalled();
  });

  it("the summary DataStruct has one row per dataset and lands in the library", async () => {
    setLibrary(
      [
        { id: "a", name: "alpha", data: angularMap() },
        { id: "b", name: "beta", data: angularMap() },
      ],
      ["a", "b"],
    );
    vi.mocked(rsmBoxStats)
      .mockResolvedValueOnce(stats({ integrated_intensity: 11 }))
      .mockResolvedValueOnce(stats({ integrated_intensity: 22 }));
    const { result } = renderHook(() => useRoiBatch());

    await act(async () => {
      await result.current.applyToSelected(RECT);
    });

    expect(result.current.summaryRows).toHaveLength(2);
    expect(result.current.summaryRows.map((r) => r.name)).toEqual(["alpha", "beta"]);
    expect(result.current.outcome?.summaryLanded).toBe(true);
    const landed = useApp.getState().datasets.find((d) => d.name.startsWith("ROI batch summary"));
    expect(landed).toBeTruthy();
    expect(landed?.data.values).toHaveLength(2);
    expect(landed?.data.metadata["origin_text_columns"]).toEqual({ Dataset: ["alpha", "beta"] });
  });

  it("both checkboxes off still yields N cuts (the floor)", async () => {
    setLibrary(
      [
        { id: "a", name: "alpha", data: angularMap() },
        { id: "b", name: "beta", data: angularMap() },
      ],
      ["a", "b"],
    );
    const { result } = renderHook(() => useRoiBatch());
    act(() => {
      result.current.setPlotTogether(false);
      result.current.setSummaryTable(false);
    });

    await act(async () => {
      await result.current.applyToSelected(RECT);
    });

    expect(result.current.outcome?.appliedCount).toBe(2);
    expect(rsmBoxCut).toHaveBeenCalledTimes(2);
    expect(plotSelectedTogether).not.toHaveBeenCalled();
    expect(rsmBoxStats).not.toHaveBeenCalled();
    expect(result.current.summaryRows).toHaveLength(0);
    const names = useApp.getState().datasets.map((d) => d.name);
    expect(names).toEqual(expect.arrayContaining(["alpha: box cut", "beta: box cut"]));
  });

  it("a second call is rejected while a batch is already running", async () => {
    setLibrary(
      [
        { id: "a", name: "alpha", data: angularMap() },
        { id: "b", name: "beta", data: angularMap() },
      ],
      ["a", "b"],
    );
    const { result } = renderHook(() => useRoiBatch());

    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => {
      first = result.current.applyToSelected(RECT);
      second = result.current.applyToSelected(RECT); // fired before `first` has resolved
      await Promise.all([first, second]);
    });

    // Only ONE batch actually ran (2 datasets x 1 call each = 2, not 4).
    expect(rsmBoxCut).toHaveBeenCalledTimes(2);
  });
});
