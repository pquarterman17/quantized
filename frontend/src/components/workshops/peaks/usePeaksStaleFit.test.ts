// usePeaks stale fit results: a fit started on one dataset must never land on
// another. Before the guard, switching dataset mid-fit let `setFitResult` fire
// unconditionally, so the new dataset's panel showed the old fit — and
// "→ Report" / "Label peaks" used it under the new dataset's name. The fit is
// held open by hand (no poll on the mock) and the switch happens while it is.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { findPeaks, fitMultiPeak, fitPeak } from "../../../lib/api/peaks";
import type { DataStruct, MultiFitResult, Peak, SinglePeakFit } from "../../../lib/types";
import { usePendingOps } from "../../../store/pendingOps";
import { useToasts } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import { usePeaks } from "./usePeaks";

vi.mock("../../../lib/api", () => ({
  fetchBookData: vi.fn(),
}));
vi.mock("../../../lib/api/peaks", () => ({
  findPeaks: vi.fn(),
  fitMultiPeak: vi.fn(),
  fitPeak: vi.fn(),
}));
vi.mock("../../overlays/ParamDialog", () => ({
  askParams: vi.fn(),
}));

const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5],
  values: [[1], [5], [2], [6], [2], [1]],
  labels: ["I"],
  units: ["cps"],
  metadata: {},
};

const pk = (center: number): Peak => ({
  center, height: 5, fwhm: 0.8, prominence: 1, localSNR: 10, area: null, bg: 0,
});

const FIT: MultiFitResult = {
  peaks: [{ center: 1.02, fwhm: 0.8, height: 5, bg: 1, eta: null, area: 4, status: "fitted(global)", model: "Lorentzian" }],
  bgCoeffs: [1, 0],
  R2: 0.999,
  rmse: 0.01,
  nPeaks: 1,
  model: "Lorentzian",
};

const single = (center: number): SinglePeakFit => ({
  success: true, reason: "", center, fwhm: 0.8, height: 5, bg: 1, eta: null, area: 4,
  params: [5, center, 0.8, 1], model: "Lorentzian", window: [center - 1, center + 1],
});

const OPTS = { model: "Lorentzian", bgDegree: 1, linkMode: "None", constrain: false };

/** Hold the next call to `fn` open: `started` settles when it is made. */
function holdNext<T>(fn: (...a: never[]) => Promise<T>) {
  let resolve!: (v: T) => void;
  let markStarted!: () => void;
  const started = new Promise<void>((r) => (markStarted = r));
  vi.mocked(fn).mockImplementationOnce(() => {
    markStarted();
    return new Promise<T>((r) => (resolve = r));
  });
  return { started, resolve: (v: T) => resolve(v) };
}

beforeEach(() => {
  vi.clearAllMocks();
  usePendingOps.setState({ ops: [] });
  useToasts.setState({ toasts: [] });
  useApp.setState({
    datasets: [
      { id: "d1", name: "first.dat", data: DATA },
      { id: "d2", name: "second.dat", data: DATA },
    ],
    activeId: "d1",
    xKey: null,
    yKeys: null,
    seriesOrder: null,
    peakOverlay: null,
    annotations: [],
    history: [],
    future: [],
    historySuppressed: false,
  });
  vi.mocked(findPeaks).mockResolvedValue({ peaks: [pk(1), pk(3)], background: [] });
});

async function switchToD2(result: { current: ReturnType<typeof usePeaks> }): Promise<void> {
  act(() => useApp.setState({ activeId: "d2" }));
  await waitFor(() => expect(result.current.active?.id).toBe("d2"));
  await waitFor(() => expect(result.current.peaks).toHaveLength(2)); // d2's own find landed
}

function expectNoStaleFit(result: { current: ReturnType<typeof usePeaks> }): void {
  expect(result.current.fitResult).toBeNull();
  expect(result.current.fitting).toBe(false);
  expect(result.current.fitError).toBeNull();
  // Nothing was published to either dataset, and d2's detected-peak markers survive.
  expect(useApp.getState().datasets.every((d) => d.peakTable == null)).toBe(true);
  expect(useApp.getState().peakOverlay?.datasetId).toBe("d2");
}

describe("usePeaks — a fit never lands on a dataset switched to mid-flight", () => {
  it("fitTogether: the old dataset's result is dropped after the switch", async () => {
    const fit = holdNext(fitMultiPeak);
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(2));

    let p!: Promise<void>;
    act(() => {
      p = result.current.fitTogether(OPTS);
    });
    await fit.started;
    await switchToD2(result);

    fit.resolve(FIT);
    await act(async () => {
      await p;
    });
    expectNoStaleFit(result);
  });

  it("fitEach: the loop stops and its partial result is dropped after the switch", async () => {
    const first = holdNext(fitPeak);
    vi.mocked(fitPeak).mockResolvedValue(single(3));
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(2));

    let p!: Promise<void>;
    act(() => {
      p = result.current.fitEach(OPTS);
    });
    await first.started;
    await switchToD2(result);

    first.resolve(single(1));
    await act(async () => {
      await p;
    });
    expect(fitPeak).toHaveBeenCalledTimes(1); // the old dataset's second peak never started
    expectNoStaleFit(result);
    expect(usePendingOps.getState().ops).toHaveLength(0);
  });

  it("a fit that finishes on the SAME dataset still lands (guard is not over-eager)", async () => {
    const fit = holdNext(fitMultiPeak);
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(2));

    let p!: Promise<void>;
    act(() => {
      p = result.current.fitTogether(OPTS);
    });
    await fit.started;
    fit.resolve(FIT);
    await act(async () => {
      await p;
    });
    expect(result.current.fitResult?.peaks[0].center).toBe(1.02);
    expect(result.current.fitting).toBe(false);
  });
});
