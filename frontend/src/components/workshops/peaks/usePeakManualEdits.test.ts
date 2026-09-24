import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { publishFitResult } from "../../../store/peakTables";
import { useApp } from "../../../store/useApp";
import { usePeakManualEdits } from "./usePeakManualEdits";

const data = {
  time: [0, 1, 2],
  values: [[1], [9], [2]],
  labels: ["I"],
  units: ["cps"],
  metadata: {},
};
const fit = {
  peaks: [{ center: 1, fwhm: 0.2, height: 8, bg: 1, eta: null, area: 2, status: "fitted", model: "Gaussian" }],
  bgCoeffs: [1], R2: 0.99, rmse: 0.1, nPeaks: 1, model: "Gaussian",
};

beforeEach(() => {
  useApp.setState({
    datasets: [
      { id: "d1", name: "first", data },
      { id: "d2", name: "second", data },
    ],
    activeId: "d1",
    history: [], future: [], peakOverlay: null,
  });
  publishFitResult("d1", fit, "simultaneous", { bgDegree: 0, linkMode: "none", constrain: false, xKey: null });
});

describe("usePeakManualEdits", () => {
  it("does not restore an old table or overlay after the active dataset changes during hydration", async () => {
    let finish!: (value: ReturnType<typeof useApp.getState>["datasets"][number]) => void;
    const pending = new Promise<ReturnType<typeof useApp.getState>["datasets"][number]>((resolve) => { finish = resolve; });
    const originalResolve = useApp.getState().resolveDataset;
    useApp.setState({ resolveDataset: vi.fn().mockReturnValue(pending) });
    const setFitResult = vi.fn();
    const setPeakOverlay = vi.fn();
    const overlayFitted = vi.fn();
    const { result } = renderHook(() => usePeakManualEdits({
      activeId: "d1", setFitResult, setPeakOverlay, overlayFitted,
    }));
    const peakId = useApp.getState().datasets[0].peakTable!.peaks[0].id;

    act(() => {
      void result.current.editFittedPeak(peakId, { center: 1.1, fwhm: 0.2, height: 8, area: 2 });
    });
    useApp.setState({ activeId: "d2" });
    await act(async () => {
      finish(useApp.getState().datasets[0]);
      await pending;
    });

    expect(setFitResult).not.toHaveBeenCalled();
    expect(setPeakOverlay).not.toHaveBeenCalled();
    expect(overlayFitted).not.toHaveBeenCalled();
    useApp.setState({ resolveDataset: originalResolve });
  });

  it("rehydrates the visible fitted table when undo restores the durable artifact", async () => {
    const setFitResult = vi.fn();
    const overlayFitted = vi.fn();
    const { result } = renderHook(() => usePeakManualEdits({
      activeId: "d1", setFitResult, setPeakOverlay: vi.fn(), overlayFitted,
    }));
    const peakId = useApp.getState().datasets[0].peakTable!.peaks[0].id;

    await act(async () => {
      await result.current.editFittedPeak(peakId, { center: 1.1, fwhm: 0.2, height: 8, area: 2 });
    });
    await waitFor(() => expect(setFitResult).toHaveBeenLastCalledWith(
      expect.objectContaining({ peaks: [expect.objectContaining({ center: 1.1 })] }),
    ));
    act(() => useApp.getState().undo());
    await waitFor(() => expect(setFitResult).toHaveBeenLastCalledWith(
      expect.objectContaining({ peaks: [expect.objectContaining({ center: 1 })] }),
    ));
    expect(overlayFitted).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "d1" }),
      [expect.objectContaining({ center: 1 })],
      [0, 1, 2],
    );
  });
});
