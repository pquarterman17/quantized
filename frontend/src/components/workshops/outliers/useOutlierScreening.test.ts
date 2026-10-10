import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statsDixonQ, statsGrubbs, statsMadOutliers, statsRosner } from "../../../lib/api";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useOutlierScreeningStore } from "../../../store/outlierScreening";
import { useOutlierScreening } from "./useOutlierScreening";

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  statsGrubbs: vi.fn(),
  statsRosner: vi.fn(),
  statsDixonQ: vi.fn(),
  statsMadOutliers: vi.fn(),
}));

// 8 rows, one continuous channel "y" with a single obvious outlier at
// original row 5 (value 999). Row 2 is manually excluded (#50) — the fixture
// that proves flagged indices map through the PRUNED array back to the
// correct ORIGINAL row index, not a naive off-by-exclusion index.
const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5, 6, 7],
  values: [[10], [11], [999999], [12], [13], [999], [14], [15]],
  labels: ["y"],
  units: [""],
  metadata: { x_column_name: "T" },
};

const GRUBBS_RESULT = {
  G: 3.5,
  G_critical: 2.1,
  flagged: true,
  flagged_indices: [4], // position 4 of the PRUNED (excluded-row-2-dropped) array
  index: 4,
  value: 999,
  tail: "two-sided",
  alpha: 0.05,
  N: 7,
  excluded_indices: [],
  method: "Grubbs test (single outlier)",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(statsGrubbs).mockResolvedValue(GRUBBS_RESULT);
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data: DATA, excludedRows: [2] }],
    activeId: "d1",
    status: "",
    reports: [],
    selection: null,
    analysisResults: [], history: [], future: [],
  });
  useOutlierScreeningStore.setState({ open: true, request: null });
});

describe("useOutlierScreening — defaults + dispatch", () => {
  it("defaults to the first (continuous) channel and Grubbs", async () => {
    const { result } = renderHook(() => useOutlierScreening());
    expect(result.current.col).toBe(0);
    expect(result.current.method).toBe("grubbs");
    await waitFor(() => expect(statsGrubbs).toHaveBeenCalled());
  });

  it("sends the pruned column (excluded row 2 dropped) to the backend", async () => {
    renderHook(() => useOutlierScreening());
    await waitFor(() => expect(statsGrubbs).toHaveBeenCalled());
    // Pruned order: rows 0,1,3,4,5,6,7 -> values 10,11,12,13,999,14,15.
    expect(statsGrubbs).toHaveBeenCalledWith([10, 11, 12, 13, 999, 14, 15], 0.05);
  });

  it("dispatches to rosner/dixon-q/mad on setMethod", async () => {
    vi.mocked(statsRosner).mockResolvedValue({
      num_outliers: 1, flagged_indices: [4], flagged_values: [999], table: [], k: 2, alpha: 0.05,
      N: 7, excluded_indices: [], method: "generalized ESD (Rosner)",
    });
    vi.mocked(statsDixonQ).mockResolvedValue({
      Q: 0.9, Q_critical: 0.5, ratio: "r11", tail: "high", flagged: true, flagged_indices: [4],
      index: 4, value: 999, alpha: 0.05, N: 7, excluded_indices: [], method: "Dixon's Q test",
    });
    vi.mocked(statsMadOutliers).mockResolvedValue({
      modified_z_scores: [0, 0, 0, 0, 10, 0, 0], median: 12, mad: 1, scale_method: "MAD",
      threshold: 3.5, flagged_indices: [4], N: 7, excluded_indices: [], method: "modified z-score (Iglewicz & Hoaglin)",
    });

    const { result } = renderHook(() => useOutlierScreening());
    await waitFor(() => expect(statsGrubbs).toHaveBeenCalled());

    act(() => result.current.setMethod("rosner"));
    await waitFor(() => expect(result.current.result?.method).toBe("rosner"));

    act(() => result.current.setMethod("dixon-q"));
    await waitFor(() => expect(result.current.result?.method).toBe("dixon-q"));

    act(() => result.current.setMethod("mad"));
    await waitFor(() => expect(result.current.result?.method).toBe("mad"));
  });
});

describe("useOutlierScreening — flagged-row mapping (pruned -> original index)", () => {
  it("maps a flagged PRUNED index back to the correct ORIGINAL row index across an excluded row", async () => {
    const { result } = renderHook(() => useOutlierScreening());
    await waitFor(() => expect(result.current.result).not.toBeNull());
    // Pruned position 4 (value 999) is original row 5 -- pruned order is
    // [0,1,3,4,5,6,7] (row 2 excluded), so index 4 in that list is row 5.
    expect(result.current.flaggedRowIndices).toEqual([5]);
    expect(result.current.flaggedRowValues).toEqual([{ rowIndex: 5, value: 999 }]);
  });

  it("selectFlaggedRows writes the ORIGINAL row indices to the shared selection", async () => {
    const { result } = renderHook(() => useOutlierScreening());
    await waitFor(() => expect(result.current.result).not.toBeNull());
    act(() => result.current.selectFlaggedRows());
    expect(useApp.getState().selection).toEqual({ datasetId: "d1", rows: [5] });
  });

  it("selectFlaggedRows is a no-op when nothing is flagged", async () => {
    vi.mocked(statsGrubbs).mockResolvedValue({ ...GRUBBS_RESULT, flagged: false, flagged_indices: [] });
    const { result } = renderHook(() => useOutlierScreening());
    await waitFor(() => expect(result.current.result).not.toBeNull());
    expect(result.current.flaggedRowIndices).toEqual([]);
    act(() => result.current.selectFlaggedRows());
    expect(useApp.getState().selection).toBeNull();
  });

  it("never excludes/deletes rows itself — only screens and (optionally) selects", async () => {
    const { result } = renderHook(() => useOutlierScreening());
    await waitFor(() => expect(result.current.result).not.toBeNull());
    act(() => result.current.selectFlaggedRows());
    // Exclusion list is untouched by screening/selection.
    expect(useApp.getState().datasets[0].excludedRows).toEqual([2]);
  });
});

describe("useOutlierScreening — errors", () => {
  it("surfaces a backend rejection as `error`, clearing any prior result", async () => {
    vi.mocked(statsGrubbs).mockRejectedValue(new Error("zero variance"));
    const { result } = renderHook(() => useOutlierScreening());
    await waitFor(() => expect(result.current.error).toBe("zero variance"));
    expect(result.current.result).toBeNull();
  });
});

describe("useOutlierScreening — durable results", () => {
  it("saves once, guards a same-render double save, survives remount, and is undoable", async () => {
    const first = renderHook(() => useOutlierScreening());
    await waitFor(() => expect(first.result.current.canSaveResult).toBe(true));
    act(() => {
      first.result.current.saveResult();
      first.result.current.saveResult();
    });
    expect(useApp.getState().analysisResults).toHaveLength(1);
    expect(first.result.current.canSaveResult).toBe(false);
    first.unmount();
    const reopened = renderHook(() => useOutlierScreening());
    await waitFor(() => expect(reopened.result.current.result).not.toBeNull());
    expect(reopened.result.current.canSaveResult).toBe(false);
    act(() => useApp.getState().undo());
    expect(useApp.getState().analysisResults).toHaveLength(0);
  });

  it("restores and consumes the exact saved controls", async () => {
    useOutlierScreeningStore.getState().openWith({ col: -1, method: "mad", alpha: 0.01, k: 4, threshold: 4.5 });
    const { result } = renderHook(() => useOutlierScreening());
    await waitFor(() => expect(result.current.col).toBe(-1));
    expect(result.current).toMatchObject({ method: "mad", alpha: 0.01, k: 4, threshold: 4.5 });
    expect(useOutlierScreeningStore.getState().request).toBeNull();
  });

  it("never offers a stale result while a changed method is running", async () => {
    let finish!: (value: Awaited<ReturnType<typeof statsMadOutliers>>) => void;
    vi.mocked(statsMadOutliers).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useOutlierScreening());
    await waitFor(() => expect(result.current.canSaveResult).toBe(true));
    act(() => result.current.setMethod("mad"));
    expect(result.current.canSaveResult).toBe(false);
    expect(result.current.result).toBeNull();
    act(() => finish({
      modified_z_scores: [0, 0, 0, 0, 10, 0, 0], median: 12, mad: 1, scale_method: "MAD",
      threshold: 3.5, flagged_indices: [4], N: 7, excluded_indices: [], method: "modified z-score",
    }));
    await waitFor(() => expect(result.current.canSaveResult).toBe(true));
  });

  it("allows a fresh result after the analysis view changes", async () => {
    const { result, rerender } = renderHook(() => useOutlierScreening());
    await waitFor(() => expect(result.current.canSaveResult).toBe(true));
    act(() => { result.current.saveResult(); });
    useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: DATA, excludedRows: [2, 3] }] });
    rerender();
    await waitFor(() => expect(result.current.canSaveResult).toBe(true));
  });

  it("invalidates the landed result immediately when the active worksheet changes in place", async () => {
    const { result, rerender } = renderHook(() => useOutlierScreening());
    await waitFor(() => expect(result.current.canSaveResult).toBe(true));
    useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: {
      ...DATA, values: DATA.values.map((row, index) => index === 0 ? [20] : row),
    }, excludedRows: [2] }] });
    rerender();
    expect(result.current.result).toBeNull();
    expect(result.current.canSaveResult).toBe(false);
    await waitFor(() => expect(result.current.canSaveResult).toBe(true));
  });
});
