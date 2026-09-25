import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { publishFitResult, setPeakExcluded } from "../../../store/peakTables";
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

const realResolve = useApp.getState().resolveDataset;
afterEach(() => {
  // Restored here, not at the end of a test body, so a failing test cannot
  // leak its mock into the next one.
  useApp.setState({ resolveDataset: realResolve });
});

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
  });

  it("drops a stale refresh after an A→B→A switch (the generation guard)", async () => {
    // The activeId check alone cannot catch this: by the time the first
    // refresh resolves, the store is back on d1. Only the generation counter
    // tells the stale continuation from the current one.
    type Ds = ReturnType<typeof useApp.getState>["datasets"][number];
    const resolvers: ((ds: Ds | undefined) => void)[] = [];
    useApp.setState({
      resolveDataset: vi.fn(() => new Promise<Ds | undefined>((resolve) => { resolvers.push(resolve); })),
    });
    const setFitResult = vi.fn();
    const { rerender } = renderHook(
      ({ id }: { id: string }) => usePeakManualEdits({
        activeId: id, setFitResult, setPeakOverlay: vi.fn(), overlayFitted: vi.fn(),
      }),
      { initialProps: { id: "d1" } },
    );
    act(() => useApp.setState({ activeId: "d2" }));
    rerender({ id: "d2" }); // d2 has no table: clears synchronously
    act(() => useApp.setState({ activeId: "d1" }));
    rerender({ id: "d1" });
    const d1 = useApp.getState().datasets[0];
    expect(resolvers).toHaveLength(2);

    await act(async () => {
      resolvers[1](d1); // the current refresh lands first
      await Promise.resolve();
    });
    await act(async () => {
      resolvers[0](d1); // then the stale one from before the switch
      await Promise.resolve();
    });
    const tableCalls = setFitResult.mock.calls.filter(([v]) => v !== null);
    expect(tableCalls).toHaveLength(1);
  });

  it("does not replace the fit result when only a peak's inclusion changes", async () => {
    const setFitResult = vi.fn();
    renderHook(() => usePeakManualEdits({
      activeId: "d1", setFitResult, setPeakOverlay: vi.fn(), overlayFitted: vi.fn(),
    }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0)); // let the initial hydration land
    });
    expect(setFitResult).toHaveBeenCalledTimes(1);
    const peakId = useApp.getState().datasets[0].peakTable!.peaks[0].id;
    act(() => setPeakExcluded("d1", peakId, true));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    // A replaced fit result would reset the fitted-row selection and swap the
    // plot markers on every include/exclude click.
    expect(setFitResult).toHaveBeenCalledTimes(1);
    expect(useApp.getState().datasets[0].peakTable!.peaks[0].excluded).toBe(true);
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
