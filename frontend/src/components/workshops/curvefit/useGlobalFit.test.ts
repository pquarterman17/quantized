// Global fit hook: picks series (channels of the active dataset, or datasets
// matched by column label), posts each one's analysis rows with the sharing
// constraints to the job-queued /api/fitting/global/job, and overlays each
// member's fitted curve on its own dataset through the store's fit overlay.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { globalFitJob, type GlobalFitResult } from "../../../lib/api/globalFit";
import { reportEmit } from "../../../lib/api/report";
import { JobCancelledError, pollJob } from "../../../lib/jobs";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useGlobalFit, type GlobalModel } from "./useGlobalFit";

vi.mock("../../../lib/api/globalFit", () => ({ globalFitJob: vi.fn() }));
vi.mock("../../../lib/api/report", () => ({ reportEmit: vi.fn() }));
vi.mock("../../../lib/jobs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/jobs")>();
  return { ...actual, pollJob: vi.fn(), cancelJob: vi.fn() };
});

const D1: Dataset = {
  id: "d1",
  name: "run1.dat",
  data: {
    time: [0, 1, 2, 3],
    values: [
      [0, 1, 2],
      [1, 3, Number.NaN],
      [2, 5, 8],
      [3, 7, 11],
    ],
    labels: ["x", "A", "B"],
    units: ["", "", ""],
    metadata: {},
  },
};
const D2: Dataset = {
  id: "d2",
  name: "run2.dat",
  data: {
    time: [0, 1, 2],
    values: [
      [10, 0, 4],
      [20, 1, 6],
      [30, 2, 8],
    ],
    labels: ["T", "x", "A"],
    units: ["", "", ""],
    metadata: {},
  },
};
const D3: Dataset = {
  id: "d3",
  name: "other.dat",
  data: { time: [0, 1], values: [[1], [2]], labels: ["Q"], units: [""], metadata: {} },
};

const MODEL: GlobalModel = { name: "Linear", paramNames: ["m", "b"], p0: [1, 0], lb: [null, null], ub: [null, null] };

const FIT_CHANNELS: GlobalFitResult = {
  paramNames: ["m", "b"],
  params: [
    [2, 1],
    [3, 1],
  ],
  errors: [
    [0.1, 0.05],
    [0.2, 0.05],
  ],
  shared: [{ name: "b", paramIdx: 1, datasets: [0, 1], value: 1, error: 0.05 }],
  yFit: [
    [1, 3, 5, 7],
    [1, 7, 10],
  ],
  R2: [0.99, 0.98],
  RMSE: [0.1, 0.2],
  chiSqRed: 1.5,
  nTotal: 7,
  nFree: 3,
  exitFlag: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(globalFitJob).mockResolvedValue({ job_id: "j1" });
  vi.mocked(pollJob).mockResolvedValue(FIT_CHANNELS);
  useApp.setState({
    datasets: [D1, D2, D3],
    activeId: "d1",
    selectedIds: ["d1"],
    xKey: 0,
    yKeys: [1, 2],
    seriesOrder: null,
    fitOverlay: null,
    reports: [],
  });
});

describe("useGlobalFit — channels of the active dataset", () => {
  it("offers every non-X channel and pre-picks the plotted ones", () => {
    const { result } = renderHook(() => useGlobalFit(MODEL));
    expect(result.current.source).toBe("channels");
    expect(result.current.candidates.map((m) => m.label)).toEqual(["A", "B"]);
    expect(result.current.picked).toEqual(["d1:1", "d1:2"]);
  });

  it("posts each channel's finite rows with the sharing constraints and overlays the active member", async () => {
    const { result } = renderHook(() => useGlobalFit(MODEL));
    act(() => result.current.setShared(1, true));
    await act(() => result.current.run());
    await waitFor(() => expect(result.current.result).not.toBeNull());
    expect(vi.mocked(globalFitJob).mock.calls[0]![0]).toEqual({
      model: "Linear",
      datasets: [
        { x: [0, 1, 2, 3], y: [1, 3, 5, 7] },
        { x: [0, 2, 3], y: [2, 8, 11] },
      ],
      constraints: [{ param_name: "b", datasets: [0, 1] }],
      lower: [null, null],
      upper: [null, null],
    });
    // The first member of the active dataset is shown, aligned to its rows.
    expect(result.current.shownIndex).toBe(0);
    expect(useApp.getState().fitOverlay).toEqual({ datasetId: "d1", y: [1, 3, 5, 7] });
    // Showing channel B puts ITS curve on the plot, the gap row left empty.
    act(() => result.current.show(1));
    await waitFor(() => expect(useApp.getState().fitOverlay?.y[2]).toBe(7));
    expect(useApp.getState().fitOverlay?.y[1]).toBeNaN();
  });

  it("sends an edited start vector (broadcast) and edited bounds", async () => {
    const { result } = renderHook(() => useGlobalFit(MODEL));
    act(() => result.current.setRow(0, { start: "2.5", min: "0" }));
    await act(() => result.current.run());
    await waitFor(() => expect(result.current.result).not.toBeNull());
    const req = vi.mocked(globalFitJob).mock.calls[0]![0];
    expect(req.p0).toEqual([2.5, 0]);
    expect(req.lower).toEqual([0, null]);
    expect(req.constraints).toEqual([]);
  });

  it("fits a saved custom equation by its text", async () => {
    const eq: GlobalModel = { ...MODEL, name: "line", equation: "y = m*x + b" };
    const { result } = renderHook(() => useGlobalFit(eq));
    await act(() => result.current.run());
    await waitFor(() => expect(result.current.result).not.toBeNull());
    const req = vi.mocked(globalFitJob).mock.calls[0]![0];
    expect(req.equation).toBe("y = m*x + b");
    expect(req).not.toHaveProperty("model");
  });

  it("refuses fewer than two series without submitting a job", async () => {
    const { result } = renderHook(() => useGlobalFit(MODEL));
    act(() => result.current.togglePick("d1:2"));
    await act(() => result.current.run());
    await waitFor(() => expect(result.current.error).toMatch(/at least two/));
    expect(globalFitJob).not.toHaveBeenCalled();
  });

  it("a cancel is not an error and leaves no result", async () => {
    vi.mocked(pollJob).mockRejectedValue(new JobCancelledError("j1"));
    const { result } = renderHook(() => useGlobalFit(MODEL));
    await act(() => result.current.run());
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.result).toBeNull();
  });

  it("clears its own overlay on unmount, and never someone else's", async () => {
    const { result, unmount } = renderHook(() => useGlobalFit(MODEL));
    await act(() => result.current.run());
    await waitFor(() => expect(useApp.getState().fitOverlay?.datasetId).toBe("d1"));
    unmount();
    expect(useApp.getState().fitOverlay).toBeNull();

    const other = { datasetId: "d1", y: [9, 9, 9, 9] };
    const second = renderHook(() => useGlobalFit(MODEL));
    await act(() => second.result.current.run());
    await waitFor(() => expect(useApp.getState().fitOverlay?.y).toEqual([1, 3, 5, 7]));
    act(() => useApp.getState().setFitOverlay(other));
    second.unmount();
    expect(useApp.getState().fitOverlay).toBe(other);
  });

  it("a model change drops the previous result and its curve", async () => {
    const { result, rerender } = renderHook(({ m }) => useGlobalFit(m), { initialProps: { m: MODEL } });
    await act(() => result.current.run());
    await waitFor(() => expect(useApp.getState().fitOverlay?.datasetId).toBe("d1"));
    rerender({ m: { ...MODEL, name: "Quadratic", paramNames: ["a", "b", "c"], p0: [0, 1, 0], lb: [null, null, null], ub: [null, null, null] } });
    await waitFor(() => expect(result.current.result).toBeNull());
    expect(useApp.getState().fitOverlay).toBeNull();
    expect(result.current.rows.map((r) => r.name)).toEqual(["a", "b", "c"]);
  });

  it("→ Report lands a per-dataset table in the library", async () => {
    vi.mocked(reportEmit).mockResolvedValue({ report: { title: "t" } as never });
    const { result } = renderHook(() => useGlobalFit(MODEL));
    act(() => result.current.setShared(1, true));
    await act(() => result.current.run());
    await waitFor(() => expect(result.current.result).not.toBeNull());
    await act(() => result.current.toReport());
    await waitFor(() => expect(useApp.getState().reports).toHaveLength(1));
    const body = vi.mocked(reportEmit).mock.calls[0]![0];
    expect(body.kind).toBe("stats_table");
    expect(body.records).toEqual([
      { dataset: "A", m: 2, "± m": 0.1, b: 1, "± b": 0.05, "R²": 0.99 },
      { dataset: "B", m: 3, "± m": 0.2, b: 1, "± b": 0.05, "R²": 0.98 },
    ]);
    expect(body.caption).toMatch(/shared: b/);
    expect(body.source_refs).toEqual([{ kind: "dataset", id: "d1", name: "run1.dat" }]);
  });
});

describe("useGlobalFit — datasets matched by column label", () => {
  it("finds the plotted X/Y columns by label and lists datasets that lack them", () => {
    const { result } = renderHook(() => useGlobalFit(MODEL));
    act(() => result.current.setSource("datasets"));
    expect(result.current.candidates).toEqual([
      { datasetId: "d1", xKey: 0, yKey: 1, label: "run1.dat" },
      { datasetId: "d2", xKey: 1, yKey: 2, label: "run2.dat" },
    ]);
    expect(result.current.missing).toEqual(["other.dat"]);
  });

  it("pre-picks the library selection and the overlay follows the active dataset", async () => {
    useApp.setState({ selectedIds: ["d1", "d2"] });
    vi.mocked(pollJob).mockResolvedValue({ ...FIT_CHANNELS, yFit: [[1, 3, 5, 7], [4, 6, 8]] });
    const { result } = renderHook(() => useGlobalFit(MODEL));
    act(() => result.current.setSource("datasets"));
    expect(result.current.picked).toEqual(["d1:1", "d2:2"]);
    await act(() => result.current.run());
    await waitFor(() => expect(result.current.result).not.toBeNull());
    expect(vi.mocked(globalFitJob).mock.calls[0]![0].datasets).toEqual([
      { x: [0, 1, 2, 3], y: [1, 3, 5, 7] },
      { x: [0, 1, 2], y: [4, 6, 8] },
    ]);
    expect(useApp.getState().fitOverlay?.datasetId).toBe("d1");
    act(() => useApp.setState({ activeId: "d2" }));
    await waitFor(() => expect(useApp.getState().fitOverlay).toEqual({ datasetId: "d2", y: [4, 6, 8] }));
    // A shown member stops owning the overlay once its dataset leaves the plot.
    act(() => result.current.show(1));
    act(() => useApp.setState({ activeId: "d1" }));
    await waitFor(() => expect(useApp.getState().fitOverlay).toEqual({ datasetId: "d1", y: [1, 3, 5, 7] }));
  });

  it("Show on another dataset's member makes that dataset active", async () => {
    useApp.setState({ selectedIds: ["d1", "d2"] });
    vi.mocked(pollJob).mockResolvedValue({ ...FIT_CHANNELS, yFit: [[1, 3, 5, 7], [4, 6, 8]] });
    const { result } = renderHook(() => useGlobalFit(MODEL));
    act(() => result.current.setSource("datasets"));
    await act(() => result.current.run());
    await waitFor(() => expect(result.current.result).not.toBeNull());
    act(() => result.current.show(1));
    await waitFor(() => expect(useApp.getState().fitOverlay?.datasetId).toBe("d2"));
    expect(useApp.getState().activeId).toBe("d2");
    // Activating collapses the Library selection; the fitted pick survives it.
    expect(useApp.getState().selectedIds).toEqual(["d2"]);
    expect(result.current.picked).toEqual(["d1:1", "d2:2"]);
  });
});
