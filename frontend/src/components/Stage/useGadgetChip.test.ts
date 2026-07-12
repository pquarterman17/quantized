import { fireEvent, renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { reportEmit } from "../../lib/api";
import type { DataStruct } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { useGadgetChip } from "./useGadgetChip";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  reportEmit: vi.fn(),
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
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data: DATA }],
    activeId: "d1",
    xKey: null,
    yKeys: null,
    seriesOrder: null,
    hiddenChannels: [],
    gadgetMode: "fit",
    qfitRoi: [1, 2],
    qfitModel: "Linear",
    qfitBusy: false,
    qfitResult: { params: [1, 0], errors: [0.1, 0.1], R2: 0.9 },
    qfitError: null,
    gadgetBusy: false,
    gadgetError: null,
    gadgetIntegrateResult: null,
    gadgetStatsResult: null,
    gadgetDerivResult: null,
    gadgetFftPreview: null,
    gadgetCursors: null,
    gadgetCursorResult: null,
    reports: [],
  });
});

describe("useGadgetChip — fit mode (gap #33, unchanged behavior)", () => {
  it("exposes the store's roi/model/result and the curated model list", () => {
    const { result } = renderHook(() => useGadgetChip());
    expect(result.current.roi).toEqual([1, 2]);
    expect(result.current.mode).toBe("fit");
    expect(result.current.model).toBe("Linear");
    expect(result.current.models).toContain("Gaussian");
    expect(result.current.fitResult).toEqual(expect.objectContaining({ R2: 0.9 }));
  });

  it("Escape dismisses the gadget while a roi is armed", () => {
    renderHook(() => useGadgetChip());
    expect(useApp.getState().qfitRoi).toEqual([1, 2]);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useApp.getState().qfitRoi).toBeNull();
  });

  it("a non-Escape key while armed does not clear the gadget", () => {
    renderHook(() => useGadgetChip());
    fireEvent.keyDown(window, { key: "Enter" });
    expect(useApp.getState().qfitRoi).toEqual([1, 2]);
  });

  it("is a harmless no-op with no roi/cursors armed", () => {
    useApp.setState({ qfitRoi: null });
    renderHook(() => useGadgetChip());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useApp.getState().qfitRoi).toBeNull();
  });

  it("report() emits a #36 curve_fit report and adds it to the library", async () => {
    vi.mocked(reportEmit).mockResolvedValue({
      report: { title: "t", sections: [] },
    });
    const { result } = renderHook(() => useGadgetChip());
    await act(async () => {
      await result.current.report();
    });
    expect(reportEmit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "curve_fit", model_name: "Linear" }),
    );
    expect(useApp.getState().reports).toHaveLength(1);
  });

  it("report() surfaces a failure instead of throwing", async () => {
    vi.mocked(reportEmit).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useGadgetChip());
    await act(async () => {
      await result.current.report();
    });
    expect(useApp.getState().reports).toHaveLength(0);
  });

  it("commit() delegates to the store's commitQfit", async () => {
    const { result } = renderHook(() => useGadgetChip());
    result.current.commit();
    // Durable recipe now also records the plotted channels + result snapshot
    // (audit P1 #3); single-column fixture plots channel 0 vs time.
    await waitFor(() =>
      expect(useApp.getState().datasets[0].fitSpec).toEqual({
        model: "Linear",
        xKey: null,
        yKey: 0,
        params: [1, 0],
      }),
    );
  });
});

describe("useGadgetChip — integrate mode (gap #34)", () => {
  beforeEach(() => {
    useApp.setState({
      gadgetMode: "integrate",
      gadgetIntegrateResult: {
        peaks: [{ region: [1, 2], area: 5, area_pct: 100, centroid: 1.5, height: 10, position: 1.5, fwhm: 0.5 }],
        total_area: 5,
        baseline: "linear",
      },
    });
  });

  it("exposes the integrate result and shared busy/error from gadgetBusy/gadgetError", () => {
    useApp.setState({ gadgetBusy: true, gadgetError: "boom" });
    const { result } = renderHook(() => useGadgetChip());
    expect(result.current.integrateResult?.peaks[0].area).toBe(5);
    expect(result.current.busy).toBe(true);
    expect(result.current.error).toBe("boom");
  });

  it("commit() is a no-op (nothing durable for integrate)", () => {
    const { result } = renderHook(() => useGadgetChip());
    result.current.commit();
    expect(useApp.getState().datasets[0].fitSpec).toBeUndefined();
  });

  it("report() emits an #36 integrate report verbatim", async () => {
    vi.mocked(reportEmit).mockResolvedValue({ report: { title: "t", sections: [] } });
    const { result } = renderHook(() => useGadgetChip());
    await act(async () => {
      await result.current.report();
    });
    expect(reportEmit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "integrate", result: expect.objectContaining({ total_area: 5 }) }),
    );
    expect(useApp.getState().reports).toHaveLength(1);
  });
});

describe("useGadgetChip — stats mode (gap #34)", () => {
  beforeEach(() => {
    useApp.setState({
      gadgetMode: "stats",
      gadgetStatsResult: { N: 4, mean: 25, std: 12.9, min: 10, max: 40 },
    });
  });

  it("exposes the stats result", () => {
    const { result } = renderHook(() => useGadgetChip());
    expect(result.current.statsResult).toEqual(expect.objectContaining({ N: 4, mean: 25 }));
  });

  it("report() emits an #36 stats_table report with the N/mean/std/min/max columns", async () => {
    vi.mocked(reportEmit).mockResolvedValue({ report: { title: "t", sections: [] } });
    const { result } = renderHook(() => useGadgetChip());
    await act(async () => {
      await result.current.report();
    });
    expect(reportEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "stats_table",
        records: [expect.objectContaining({ N: 4 })],
        columns: ["N", "mean", "std", "min", "max"],
      }),
    );
  });
});

describe("useGadgetChip — differentiate mode (gap #34)", () => {
  it("exposes the derivative result and commit()/report() no-op", () => {
    useApp.setState({
      gadgetMode: "differentiate",
      gadgetDerivResult: { dydx: [2, 2, 2], extremumX: 1, extremumDydx: 2 },
    });
    const { result } = renderHook(() => useGadgetChip());
    expect(result.current.derivResult?.extremumDydx).toBe(2);
    result.current.commit(); // no-op, must not throw
    expect(useApp.getState().datasets[0].fitSpec).toBeUndefined();
  });
});

describe("useGadgetChip — fft mode (gap #34)", () => {
  it("exposes the live preview; commit() adds a new library dataset via the store", () => {
    useApp.setState({
      gadgetMode: "fft",
      gadgetFftPreview: { freq: [0, 1, 2], magnitude: [0, 5, 1], df: 1, nfft: 4, fs: 4, windowName: "hanning" },
    });
    const { result } = renderHook(() => useGadgetChip());
    expect(result.current.fftPreview?.magnitude).toEqual([0, 5, 1]);
    result.current.commit();
    expect(useApp.getState().datasets).toHaveLength(2);
    expect(useApp.getState().datasets[1].name).toContain("FFT");
  });
});

describe("useGadgetChip — cursors mode (gap #34)", () => {
  it("exposes cursors + the Δx/Δy/slope readout, dismisses on Escape", () => {
    useApp.setState({
      gadgetMode: "cursors",
      qfitRoi: null,
      gadgetCursors: [1, 3],
      gadgetCursorResult: { x0: 1, y0: 20, x1: 3, y1: 40, dx: 2, dy: 20, slope: 10 },
    });
    const { result } = renderHook(() => useGadgetChip());
    expect(result.current.cursors).toEqual([1, 3]);
    expect(result.current.cursorResult?.slope).toBe(10);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useApp.getState().gadgetCursors).toBeNull();
  });
});
