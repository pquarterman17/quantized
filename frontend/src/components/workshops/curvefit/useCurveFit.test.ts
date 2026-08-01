import { renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  autoGuess,
  bootstrapFit,
  exportCornerFigure,
  fetchBookData,
  fitModel,
  listFitModels,
} from "../../../lib/api";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useCurveFit } from "./useCurveFit";

vi.mock("../../../lib/api", () => ({
  autoGuess: vi.fn(),
  fitModel: vi.fn(),
  listFitModels: vi.fn(),
  bootstrapFit: vi.fn(),
  exportCornerFigure: vi.fn(),
  fetchBookData: vi.fn(),
}));

const DATA: DataStruct = {
  time: [0, 1, 2, 3],
  values: [[10], [20], [30], [40]],
  labels: ["y"],
  units: [""],
  metadata: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listFitModels).mockResolvedValue({ models: [] });
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data: DATA }],
    activeId: "d1",
    xKey: null,
    yKeys: null,
    seriesOrder: null,
    errKeys: {}, // reset — setState merges, so a prior test's errKeys would leak
    fitOverlay: null,
  });
});

describe("useCurveFit exclusion honoring (#50/#53)", () => {
  it("fits the FULL data and overlays it 1:1 when nothing is excluded", async () => {
    vi.mocked(fitModel).mockResolvedValue({ params: [1], yFit: [11, 21, 31, 41] });
    const { result } = renderHook(() => useCurveFit());
    await act(async () => {
      await result.current.run("fit");
    });
    expect(fitModel).toHaveBeenCalledWith({ model: "Linear", x: [0, 1, 2, 3], y: [10, 20, 30, 40] });
    expect(useApp.getState().fitOverlay).toEqual({ datasetId: "d1", y: [11, 21, 31, 41] });
  });

  it("fits the primary plotted X/Y channels instead of time/values[0]", async () => {
    const multi: DataStruct = {
      time: [0, 1, 2, 3],
      values: [[100, 10, 5], [200, 20, 6], [300, 30, 7], [400, 40, 8]],
      labels: ["field", "moment", "aux"],
      units: ["Oe", "emu", ""],
      metadata: {},
    };
    useApp.setState({
      datasets: [{ id: "d1", name: "loop.dat", data: multi }],
      activeId: "d1",
      xKey: 0,
      yKeys: [2, 1],
      seriesOrder: [1, 2],
      fitOverlay: null,
    });
    vi.mocked(fitModel).mockResolvedValue({ params: [1], yFit: [11, 21, 31, 41] });
    const { result } = renderHook(() => useCurveFit());
    await act(async () => {
      await result.current.run("fit");
    });
    expect(fitModel).toHaveBeenCalledWith({
      model: "Linear",
      x: [100, 200, 300, 400],
      y: [10, 20, 30, 40],
    });
  });

  it("fits only the kept rows and expands the overlay back to full length (row 1 excluded)", async () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "run.dat", data: DATA, excludedRows: [1] }],
      activeId: "d1",
      fitOverlay: null,
    });
    // fit receives the pruned x/y → returns a pruned-length yFit
    vi.mocked(fitModel).mockResolvedValue({ params: [1], yFit: [11, 31, 41] });
    const { result } = renderHook(() => useCurveFit());
    await act(async () => {
      await result.current.run("fit");
    });
    // excluded row 1 dropped from the fit inputs
    expect(fitModel).toHaveBeenCalledWith({ model: "Linear", x: [0, 2, 3], y: [10, 30, 40] });
    // overlay expanded to full length with a null gap at the excluded row
    expect(useApp.getState().fitOverlay).toEqual({ datasetId: "d1", y: [11, null, 31, 41] });
  });

  it("also honors the local filter (#53) in the fit inputs", async () => {
    useApp.setState({
      datasets: [
        { id: "d1", name: "run.dat", data: DATA, filter: [{ col: 0, kind: "range", min: 25 }] },
      ],
      activeId: "d1",
      fitOverlay: null,
    });
    vi.mocked(fitModel).mockResolvedValue({ params: [1], yFit: [31, 41] });
    const { result } = renderHook(() => useCurveFit());
    await act(async () => {
      await result.current.run("fit");
    });
    // keep values ≥ 25 → rows 2,3 (x = 2,3; y = 30,40)
    expect(fitModel).toHaveBeenCalledWith({ model: "Linear", x: [2, 3], y: [30, 40] });
    expect(useApp.getState().fitOverlay).toEqual({ datasetId: "d1", y: [null, null, 31, 41] });
  });

  it("auto-guess also runs on the analysis subset", async () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "run.dat", data: DATA, excludedRows: [0] }],
      activeId: "d1",
    });
    vi.mocked(autoGuess).mockResolvedValue({ p0: [1] });
    const { result } = renderHook(() => useCurveFit());
    await waitFor(() => expect(listFitModels).toHaveBeenCalled());
    await act(async () => {
      await result.current.run("guess");
    });
    expect(autoGuess).toHaveBeenCalledWith("Linear", [1, 2, 3], [20, 30, 40]);
  });

  it("resolves a still-pending active dataset before fitting (#38)", async () => {
    const full: DataStruct = {
      time: [0, 1, 2, 3, 4],
      values: [[10], [20], [30], [40], [50]],
      labels: ["y"],
      units: [""],
      metadata: {},
    };
    useApp.setState({
      datasets: [
        {
          id: "d1",
          name: "book.opj",
          data: { time: [0, 1], values: [[10], [20]], labels: ["y"], units: [""], metadata: {} },
          pending: { kind: "path", path: "/p.opj", bookId: "Book2", rows: 5, cols: 1 },
        },
      ],
      activeId: "d1",
      fitOverlay: null,
    });
    vi.mocked(fetchBookData).mockResolvedValue(full);
    vi.mocked(fitModel).mockResolvedValue({ params: [1], yFit: [11, 21, 31, 41, 51] });
    const { result } = renderHook(() => useCurveFit());

    await act(async () => {
      await result.current.run("fit");
    });

    expect(fitModel).toHaveBeenCalledWith({ model: "Linear", x: full.time, y: [10, 20, 30, 40, 50] });
    expect(useApp.getState().datasets[0].pending).toBeUndefined();
    expect(useApp.getState().fitOverlay).toEqual({ datasetId: "d1", y: [11, 21, 31, 41, 51] });
  });

  it("a pending-resolve failure aborts the fit without calling fitModel", async () => {
    useApp.setState({
      datasets: [
        {
          id: "d1",
          name: "book.opj",
          data: { time: [0, 1], values: [[10], [20]], labels: ["y"], units: [""], metadata: {} },
          pending: { kind: "path", path: "/p.opj", bookId: "Book2", rows: 5, cols: 1 },
        },
      ],
      activeId: "d1",
      fitOverlay: null,
    });
    vi.mocked(fetchBookData).mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useCurveFit());

    await act(async () => {
      await result.current.run("fit");
    });

    expect(fitModel).not.toHaveBeenCalled();
    expect(result.current.error).toContain("network down");
    expect(useApp.getState().datasets[0].pending).toBeDefined(); // retryable
  });
});

describe("useCurveFit weighting (Sol audit — connect fitting to error columns)", () => {
  it("sends no dy and records no weight in the default (none) mode", async () => {
    vi.mocked(fitModel).mockResolvedValue({ params: [1], yFit: [11, 21, 31, 41], exitFlag: 1 });
    const { result } = renderHook(() => useCurveFit());
    await act(async () => {
      await result.current.run("fit");
    });
    expect(fitModel).toHaveBeenCalledWith({ model: "Linear", x: [0, 1, 2, 3], y: [10, 20, 30, 40] });
    expect(useApp.getState().datasets[0].fitSpec?.weight).toBeUndefined();
  });

  it("threads the designated Y-error column into dy and records it in provenance", async () => {
    const multi: DataStruct = {
      time: [0, 1, 2, 3],
      values: [[10, 2], [20, 4], [30, 3], [40, 5]],
      labels: ["moment", "err"],
      units: ["emu", "emu"],
      metadata: {},
    };
    useApp.setState({
      datasets: [{ id: "d1", name: "run.dat", data: multi }],
      activeId: "d1",
      xKey: null,
      yKeys: [0],
      seriesOrder: null,
      errKeys: { 0: 1 }, // moment(0) -> err(1)
      fitOverlay: null,
    });
    vi.mocked(fitModel).mockResolvedValue({ params: [1], yFit: [11, 21, 31, 41], exitFlag: 1 });
    const { result } = renderHook(() => useCurveFit());
    expect(result.current.hasYErr).toBe(true);
    act(() => result.current.setWeightMode("yerr"));
    await act(async () => {
      await result.current.run("fit");
    });
    expect(fitModel).toHaveBeenCalledWith({
      model: "Linear",
      x: [0, 1, 2, 3],
      y: [10, 20, 30, 40],
      dy: [2, 4, 3, 5],
    });
    expect(useApp.getState().datasets[0].fitSpec?.weight).toEqual({ mode: "yerr", errKey: 1 });
  });

  it("poisson mode sends dy = sqrt(max(|y|,1))", async () => {
    vi.mocked(fitModel).mockResolvedValue({ params: [1], yFit: [11, 21, 31, 41] });
    const { result } = renderHook(() => useCurveFit());
    act(() => result.current.setWeightMode("poisson"));
    await act(async () => {
      await result.current.run("fit");
    });
    expect(fitModel).toHaveBeenCalledWith({
      model: "Linear",
      x: [0, 1, 2, 3],
      y: [10, 20, 30, 40],
      dy: [Math.sqrt(10), Math.sqrt(20), Math.sqrt(30), Math.sqrt(40)],
    });
    expect(useApp.getState().datasets[0].fitSpec?.weight).toEqual({ mode: "poisson" });
  });

  it("yerr with no designated column fits unweighted and surfaces a note", async () => {
    // default DATA has no error column and no errKeys -> hasYErr false
    vi.mocked(fitModel).mockResolvedValue({ params: [1], yFit: [11, 21, 31, 41] });
    const { result } = renderHook(() => useCurveFit());
    expect(result.current.hasYErr).toBe(false);
    act(() => result.current.setWeightMode("yerr"));
    await act(async () => {
      await result.current.run("fit");
    });
    // no dy key -> unweighted; a note explains why
    expect(fitModel).toHaveBeenCalledWith({ model: "Linear", x: [0, 1, 2, 3], y: [10, 20, 30, 40] });
    expect(result.current.weightNote).toMatch(/no error column/);
    // provenance honestly records that it ran unweighted
    expect(useApp.getState().datasets[0].fitSpec?.weight).toBeUndefined();
  });
});

describe("useCurveFit corner plot (gap #29 UI leg)", () => {
  it("is a no-op with no fit result yet", async () => {
    const { result } = renderHook(() => useCurveFit());
    await act(async () => {
      await result.current.runCornerPlot();
    });
    expect(bootstrapFit).not.toHaveBeenCalled();
  });

  it("is a no-op after an auto-guess (guessOnly) — no completed fit to bootstrap", async () => {
    vi.mocked(autoGuess).mockResolvedValue({ p0: [1] });
    const { result } = renderHook(() => useCurveFit());
    await act(async () => {
      await result.current.run("guess");
    });
    await act(async () => {
      await result.current.runCornerPlot();
    });
    expect(bootstrapFit).not.toHaveBeenCalled();
  });

  it("bootstraps with return_samples then exports the corner figure with the fit's params as truths", async () => {
    vi.mocked(fitModel).mockResolvedValue({ params: [2, 5], yFit: [10, 20, 30, 40] });
    vi.mocked(bootstrapFit).mockResolvedValue({
      params: [2, 5],
      boot_mean: [2, 5],
      boot_se: [0.1, 0.2],
      ciLow: [1.8, 4.6],
      ciHigh: [2.2, 5.4],
      n_boot: 500,
      n_failed: 0,
      boot_samples: [
        [1.9, 4.9],
        [2.1, 5.1],
      ],
    });
    const { result } = renderHook(() => useCurveFit());
    await act(async () => {
      await result.current.run("fit");
    });
    await act(async () => {
      await result.current.runCornerPlot();
    });
    expect(bootstrapFit).toHaveBeenCalledWith({
      model: "Linear",
      x: [0, 1, 2, 3],
      y: [10, 20, 30, 40],
      p0: [2, 5],
      return_samples: true,
    });
    expect(exportCornerFigure).toHaveBeenCalledWith(
      expect.objectContaining({
        samples: [
          [1.9, 4.9],
          [2.1, 5.1],
        ],
        truths: [2, 5],
        filename: "run-corner",
      }),
    );
    expect(result.current.error).toBeNull();
  });

  it("surfaces a bootstrap failure as an error instead of throwing", async () => {
    vi.mocked(fitModel).mockResolvedValue({ params: [2, 5], yFit: [10, 20, 30, 40] });
    vi.mocked(bootstrapFit).mockRejectedValue(new Error("bootstrap unstable"));
    const { result } = renderHook(() => useCurveFit());
    await act(async () => {
      await result.current.run("fit");
    });
    await act(async () => {
      await result.current.runCornerPlot();
    });
    expect(exportCornerFigure).not.toHaveBeenCalled();
    expect(result.current.error).toBe("bootstrap unstable");
    expect(result.current.cornerBusy).toBe(false);
  });
});

// 12 rows: col0 "grp" (2-level nominal By column), col1 "y" (continuous,
// plotted). Nominal inference needs >=12 samples, <=8 distinct levels, each
// level used >=3x on average — grp (2 distinct / 12 rows) qualifies; y (12
// distinct values) does not, so it reads continuous and is what's plotted.
const BY_DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  values: [
    [0, 10], [0, 20], [0, 30], [0, 40], [0, 50], [0, 60],
    [1, 15], [1, 25], [1, 35], [1, 45], [1, 55], [1, 65],
  ],
  labels: ["grp", "y"],
  units: ["", ""],
  metadata: {},
};

describe("useCurveFit — By grouping (JMP_GAP_PLAN J7 residual)", () => {
  beforeEach(() => {
    useApp.setState({
      datasets: [{ id: "d1", name: "run.dat", data: BY_DATA }],
      activeId: "d1",
      xKey: null,
      yKeys: [1],
      seriesOrder: null,
      errKeys: {},
      fitOverlay: null,
    });
  });

  it("offers the categorical column as By, excluding the plotted y channel", async () => {
    const { result } = renderHook(() => useCurveFit());
    await waitFor(() => expect(result.current.byOptions.length).toBeGreaterThan(0));
    expect(result.current.byOptions).toEqual([{ index: 0, label: "grp" }]);
  });

  it("fits each level independently on its own x/y slice, never touching the plot overlay", async () => {
    vi.mocked(fitModel).mockImplementation((body: { x: number[] }) =>
      Promise.resolve({ params: [body.x[0]], yFit: body.x.map(() => 0) }),
    );
    const { result } = renderHook(() => useCurveFit());
    await waitFor(() => expect(result.current.byOptions.length).toBeGreaterThan(0));
    act(() => result.current.setByCol(0));
    await waitFor(() => expect(result.current.byResults).toHaveLength(2));

    expect(fitModel).toHaveBeenCalledWith(
      expect.objectContaining({ model: "Linear", x: [0, 1, 2, 3, 4, 5], y: [10, 20, 30, 40, 50, 60] }),
    );
    expect(fitModel).toHaveBeenCalledWith(
      expect.objectContaining({ model: "Linear", x: [6, 7, 8, 9, 10, 11], y: [15, 25, 35, 45, 55, 65] }),
    );
    // Display-only: the singleton overlay/spec are untouched by By fetches.
    expect(useApp.getState().fitOverlay).toBeNull();
    expect(useApp.getState().datasets[0].fitSpec).toBeUndefined();
  });

  it("a level too small/invalid for the model surfaces an honest per-level error, not a crash", async () => {
    vi.mocked(fitModel).mockImplementation((body: { x: number[] }) =>
      body.x[0] === 0
        ? Promise.reject(new Error("singular"))
        : Promise.resolve({ params: [1], yFit: body.x.map(() => 0) }),
    );
    const { result } = renderHook(() => useCurveFit());
    await waitFor(() => expect(result.current.byOptions.length).toBeGreaterThan(0));
    act(() => result.current.setByCol(0));
    await waitFor(() => expect(result.current.byResults).toHaveLength(2));
    const [lvl0, lvl1] = result.current.byResults;
    expect(lvl0.error).toBe("singular");
    expect(lvl0.result).toBeNull();
    expect(lvl1.error).toBeNull();
    expect(lvl1.result).not.toBeNull();
  });

  it("re-fits every level when the model changes", async () => {
    vi.mocked(fitModel).mockResolvedValue({ params: [1], yFit: [0] });
    const { result } = renderHook(() => useCurveFit());
    await waitFor(() => expect(result.current.byOptions.length).toBeGreaterThan(0));
    act(() => result.current.setByCol(0));
    await waitFor(() => expect(result.current.byResults).toHaveLength(2));
    vi.mocked(fitModel).mockClear();
    act(() => result.current.setModelName("Quadratic"));
    await waitFor(() =>
      expect(fitModel).toHaveBeenCalledWith(expect.objectContaining({ model: "Quadratic" })),
    );
  });

  it("clears byResults when By is set back to none", async () => {
    vi.mocked(fitModel).mockResolvedValue({ params: [1], yFit: [0] });
    const { result } = renderHook(() => useCurveFit());
    await waitFor(() => expect(result.current.byOptions.length).toBeGreaterThan(0));
    act(() => result.current.setByCol(0));
    await waitFor(() => expect(result.current.byResults).toHaveLength(2));
    act(() => result.current.setByCol(null));
    await waitFor(() => expect(result.current.byResults).toHaveLength(0));
  });
});
