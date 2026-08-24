import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { findPeaks, fitMultiPeak, fitPeak } from "../../../lib/api/peaks";
import { fetchBookData } from "../../../lib/api";
import { askParams } from "../../overlays/ParamDialog";
import type { Annotation, DataStruct, MultiFitResult, Peak, SinglePeakFit } from "../../../lib/types";
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

function pk(center: number, height: number, fwhm: number, bg = 0): Peak {
  return { center, height, fwhm, prominence: 1, localSNR: 10, area: null, bg };
}

function fitted(center: number): MultiFitResult {
  return {
    peaks: [
      { center, fwhm: 0.8, height: 5, bg: 1, eta: null, area: 4, status: "fitted(global)", model: "Lorentzian" },
    ],
    bgCoeffs: [1, 0],
    R2: 0.999,
    rmse: 0.01,
    nPeaks: 1,
    model: "Lorentzian",
  };
}

function single(center: number, success: boolean): SinglePeakFit {
  return {
    success,
    reason: success ? "" : "window-too-narrow",
    center,
    fwhm: 0.8,
    height: 5,
    bg: 1,
    eta: null,
    area: 4,
    params: [5, center, 0.8, 1],
    model: "Lorentzian",
    window: [center - 1, center + 1],
  };
}

const OPTS = { model: "Lorentzian", bgDegree: 1, linkMode: "None", constrain: false };

beforeEach(() => {
  vi.clearAllMocks();
  usePendingOps.setState({ ops: [] });
  useToasts.setState({ toasts: [] });
  useApp.setState({
    datasets: [{ id: "d1", name: "x.dat", data: DATA }],
    activeId: "d1",
    xKey: null,
    yKeys: null,
    seriesOrder: null,
    peakOverlay: null,
    annotations: [],
    history: [],
    future: [],
    historySuppressed: false,
    xLim: null,
    yLim: null,
    yScale: "linear",
  });
  vi.mocked(findPeaks).mockResolvedValue({
    peaks: [pk(1, 5, 0.8), pk(3, 6, 0.9)],
    background: [],
  });
});

describe("usePeaks find", () => {
  it("auto-finds peaks on the active dataset and sets the overlay", async () => {
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(2));
    expect(findPeaks).toHaveBeenCalledOnce();
    expect(useApp.getState().peakOverlay?.datasetId).toBe("d1");
  });

  it("resolves a still-pending active dataset before auto-finding (#38)", async () => {
    const full: DataStruct = {
      time: [0, 1, 2, 3, 4, 5, 6],
      values: [[1], [5], [2], [6], [2], [1], [1]],
      labels: ["I"],
      units: ["cps"],
      metadata: {},
    };
    useApp.setState({
      datasets: [
        {
          id: "d1",
          name: "book.opj",
          data: { time: [0, 1], values: [[1], [5]], labels: ["I"], units: ["cps"], metadata: {} },
          pending: { kind: "path", path: "/p.opj", bookId: "Book2", rows: 7, cols: 1 },
        },
      ],
      activeId: "d1",
      peakOverlay: null,
    });
    vi.mocked(fetchBookData).mockResolvedValue(full);

    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(2));

    const body = vi.mocked(findPeaks).mock.calls[0][0];
    expect(body.x).toEqual(full.time); // ran against the RESOLVED data, not the 2-point preview
    expect(useApp.getState().datasets[0].pending).toBeUndefined();
  });

  it("a pending-resolve failure surfaces an error and never calls findPeaks", async () => {
    useApp.setState({
      datasets: [
        {
          id: "d1",
          name: "book.opj",
          data: { time: [0, 1], values: [[1], [5]], labels: ["I"], units: ["cps"], metadata: {} },
          pending: { kind: "path", path: "/p.opj", bookId: "Book2", rows: 7, cols: 1 },
        },
      ],
      activeId: "d1",
      peakOverlay: null,
    });
    vi.mocked(fetchBookData).mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.error).toBeTruthy());

    expect(findPeaks).not.toHaveBeenCalled();
    expect(result.current.peaks).toHaveLength(0);
  });
});

describe("usePeaks find — round-2 review L2: detected-peak marker overlay height+bg", () => {
  it("draws detected-peak markers at height + bg, not height alone (pre-existing bug this review surfaced)", async () => {
    // A large background, same repro shape as L1: apex is height+bg=530,
    // nowhere near height=30 or 0. `overlayFitted` (the FITTED-peak overlay)
    // already gets this right; the detected-peak overlay never did.
    vi.mocked(findPeaks).mockResolvedValue({
      peaks: [pk(1, 30, 0.8, 500), pk(3, 25, 0.9, 500)],
      background: [],
    });
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(2));

    const overlayY = useApp.getState().peakOverlay?.y ?? [];
    const markerValues = overlayY.filter((v): v is number => v != null);
    expect(markerValues).toHaveLength(2);
    for (const v of markerValues) {
      expect(v).toBeGreaterThan(400); // height+bg (~530/525), not height (~30) or bare bg
    }
  });
});

describe("usePeaks exclusion honoring (#50/#53)", () => {
  it("detects on the pruned analysis view but builds a full-length overlay", async () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "x.dat", data: DATA, excludedRows: [1, 3] }],
      activeId: "d1",
      peakOverlay: null,
    });
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(2));
    // excluded rows 1, 3 dropped from the detection inputs
    const body = vi.mocked(findPeaks).mock.calls[0][0];
    expect(body.x).toEqual([0, 2, 4, 5]);
    expect(body.y).toEqual([1, 2, 2, 1]);
    // overlay stays full-length (6 points) so it aligns with the plot x
    expect(useApp.getState().peakOverlay?.y).toHaveLength(6);
  });

  it("fits (fitTogether) on the pruned analysis view", async () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "x.dat", data: DATA, excludedRows: [0, 5] }],
      activeId: "d1",
      peakOverlay: null,
    });
    vi.mocked(fitMultiPeak).mockResolvedValue(fitted(1.02));
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(2));
    await act(async () => {
      await result.current.fitTogether(OPTS);
    });
    const body = vi.mocked(fitMultiPeak).mock.calls[0][0];
    expect(body.x).toEqual([1, 2, 3, 4]); // rows 0 and 5 dropped
    expect(body.y).toEqual([5, 2, 6, 2]);
  });
});

describe("usePeaks plotted-channel selection (audit P1 #1)", () => {
  it("finds + fits the plotted X/primary-Y, not time/values[0]", async () => {
    const multi: DataStruct = {
      time: [0, 1, 2, 3],
      values: [[100, 10], [200, 50], [300, 20], [400, 5]],
      labels: ["angle", "counts"],
      units: ["deg", "cps"],
      metadata: {},
    };
    vi.mocked(findPeaks).mockResolvedValue({ peaks: [pk(200, 50, 30)], background: [] });
    vi.mocked(fitMultiPeak).mockResolvedValue(fitted(200));
    useApp.setState({
      datasets: [{ id: "d1", name: "xrd.dat", data: multi }],
      activeId: "d1",
      xKey: 0, // angle
      yKeys: [1], // counts
      seriesOrder: null,
      peakOverlay: null,
    });
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(1));
    const found = vi.mocked(findPeaks).mock.calls[0][0];
    expect(found.x).toEqual([100, 200, 300, 400]); // angle channel, not time
    expect(found.y).toEqual([10, 50, 20, 5]); // counts channel, not values[0]
    // overlay aligns to the FULL plotted x (angle), length 4
    expect(useApp.getState().peakOverlay?.y).toHaveLength(4);

    await act(async () => {
      await result.current.fitTogether(OPTS);
    });
    const fitBody = vi.mocked(fitMultiPeak).mock.calls[0][0];
    expect(fitBody.x).toEqual([100, 200, 300, 400]);
    expect(fitBody.y).toEqual([10, 50, 20, 5]);
  });
});

describe("usePeaks fitTogether", () => {
  it("sends detected peaks as seeds to /fit-multi and stores the result", async () => {
    vi.mocked(fitMultiPeak).mockResolvedValue(fitted(1.02));
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(2));

    await act(async () => {
      await result.current.fitTogether(OPTS);
    });

    expect(fitMultiPeak).toHaveBeenCalledOnce();
    const body = vi.mocked(fitMultiPeak).mock.calls[0][0];
    expect(body.peaks).toEqual([
      { center: 1, fwhm: 0.8, height: 5 },
      { center: 3, fwhm: 0.9, height: 6 },
    ]);
    expect(body.model).toBe("Lorentzian");
    expect(body.bg_degree).toBe(1);
    expect(result.current.fitResult?.R2).toBe(0.999);
  });

  it("reports a fit error without throwing", async () => {
    vi.mocked(fitMultiPeak).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(2));
    await act(async () => {
      await result.current.fitTogether(OPTS);
    });
    expect(result.current.fitError).toBe("boom");
    expect(result.current.fitResult).toBeNull();
  });
});

describe("usePeaks fitEach", () => {
  it("fits each detected peak independently via /fit and keeps the successes", async () => {
    vi.mocked(fitPeak)
      .mockResolvedValueOnce(single(1.0, true))
      .mockResolvedValueOnce(single(3.0, false)); // second peak fails
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(2));

    await act(async () => {
      await result.current.fitEach(OPTS);
    });

    expect(fitPeak).toHaveBeenCalledTimes(2);
    // window derives from the seed FWHM (±3·FWHM around center)
    const firstCall = vi.mocked(fitPeak).mock.calls[0][0];
    expect(firstCall.x_lo).toBeCloseTo(1 - 2.4);
    expect(firstCall.x_hi).toBeCloseTo(1 + 2.4);
    expect(result.current.fitResult?.peaks).toHaveLength(1); // only the success
    expect(result.current.fitResult?.R2).toBeNull(); // independent fits → no global R²
  });
});

describe("usePeaks fitEach — per-peak progress + cancel (P0.4 feedback/cancel tail)", () => {
  it("registers a pendingOps entry that ticks 'Fitting peak i/N…' per peak, then clears it", async () => {
    let resolve1!: (v: SinglePeakFit) => void;
    let resolve2!: (v: SinglePeakFit) => void;
    vi.mocked(fitPeak)
      .mockReturnValueOnce(new Promise((r) => (resolve1 = r)))
      .mockReturnValueOnce(new Promise((r) => (resolve2 = r)));
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(2));

    let p!: Promise<void>;
    act(() => {
      p = result.current.fitEach(OPTS);
    });
    expect(usePendingOps.getState().ops).toHaveLength(1);
    expect(usePendingOps.getState().ops[0].label).toBe("Fitting peak 1/2…");

    resolve1(single(1.0, true));
    await waitFor(() =>
      expect(usePendingOps.getState().ops[0].label).toBe("Fitting peak 2/2…"),
    );
    // Same op relabelled, not a second registration.
    expect(usePendingOps.getState().ops).toHaveLength(1);

    resolve2(single(3.0, true));
    await act(async () => {
      await p;
    });
    expect(usePendingOps.getState().ops).toHaveLength(0);
  });

  it("the registered op carries a cancel callback", async () => {
    vi.mocked(fitPeak).mockReturnValue(new Promise<SinglePeakFit>(() => {}));
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(2));

    act(() => {
      void result.current.fitEach(OPTS);
    });
    expect(typeof usePendingOps.getState().ops[0].cancel).toBe("function");
  });

  it("cancel stops the loop before the next peak, keeping already-fit results", async () => {
    let resolve1!: (v: SinglePeakFit) => void;
    vi.mocked(fitPeak).mockReturnValueOnce(new Promise((r) => (resolve1 = r)));
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(2));

    let p!: Promise<void>;
    act(() => {
      p = result.current.fitEach(OPTS);
    });
    // Wait until the first peak's fit is actually in flight before cancelling
    // — cancelling any earlier would race the still-pending resolveDataset()
    // hop and stop the loop before it ever calls fitPeak.
    await waitFor(() => expect(fitPeak).toHaveBeenCalledTimes(1));

    usePendingOps.getState().ops[0].cancel!();
    resolve1(single(1.0, true));
    await act(async () => {
      await p;
    });

    expect(fitPeak).toHaveBeenCalledTimes(1); // the second peak's fit never started
    expect(result.current.fitResult?.peaks).toHaveLength(1);
    expect(result.current.fitResult?.peaks[0].center).toBe(1.0);
    expect(result.current.fitError).toBeNull(); // a deliberate cancel is not a failure
    expect(usePendingOps.getState().ops).toHaveLength(0); // op cleaned up in `finally`
  });
});

function fitted2(c1: number, c2: number): MultiFitResult {
  return {
    peaks: [
      { center: c1, fwhm: 0.8, height: 5, bg: 1, eta: null, area: 4, status: "fitted(global)", model: "Lorentzian" },
      { center: c2, fwhm: 0.9, height: 6, bg: 1, eta: null, area: 5, status: "fitted(global)", model: "Lorentzian" },
    ],
    bgCoeffs: [1, 0],
    R2: 0.999,
    rmse: 0.01,
    nPeaks: 2,
    model: "Lorentzian",
  };
}

describe("usePeaks labelPeaks — RULING 7 (fitted-over-detected scope + empty guard)", () => {
  it("does nothing when there are no peaks to label — no dialog, no annotations", async () => {
    vi.mocked(findPeaks).mockResolvedValue({ peaks: [], background: [] });
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.busy).toBe(false));

    await act(async () => {
      await result.current.labelPeaks();
    });

    expect(askParams).not.toHaveBeenCalled();
    expect(useApp.getState().annotations).toHaveLength(0);
  });

  it("labels the FITTED peaks (not the detected ones) once a fit result exists", async () => {
    vi.mocked(fitMultiPeak).mockResolvedValue(fitted2(1.05, 3.05)); // deliberately != detected [1, 3]
    vi.mocked(askParams).mockResolvedValue({ template: "{center}", precision: 2 });
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(2));
    await act(async () => {
      await result.current.fitTogether(OPTS);
    });

    await act(async () => {
      await result.current.labelPeaks();
    });

    const anns = useApp.getState().annotations;
    expect(anns).toHaveLength(2);
    expect(anns.map((a) => a.x).sort()).toEqual([1.05, 3.05]);
    expect(anns.map((a) => a.text).sort()).toEqual(["1.05", "3.05"]);
  });

  it("falls back to the DETECTED peaks when there is no fit result", async () => {
    vi.mocked(askParams).mockResolvedValue({ template: "{center}", precision: 2 });
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(2));

    await act(async () => {
      await result.current.labelPeaks();
    });

    const anns = useApp.getState().annotations;
    expect(anns).toHaveLength(2);
    expect(anns.map((a) => a.x).sort()).toEqual([1, 3]);
  });

  it("a cancelled dialog creates zero annotations and no history entry", async () => {
    vi.mocked(askParams).mockResolvedValue(null);
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(2));
    const before = useApp.getState().history.length;

    await act(async () => {
      await result.current.labelPeaks();
    });

    expect(useApp.getState().annotations).toHaveLength(0);
    expect(useApp.getState().history.length).toBe(before);
  });
});

describe("usePeaks labelPeaks — MY RULING 1/2 (ordinary annotations, shared group identity)", () => {
  it("creates ordinary Annotation objects (no extra shape) sharing ONE groupId; editing one leaves the rest untouched", async () => {
    vi.mocked(askParams).mockResolvedValue({ template: "{center}", precision: 2 });
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(2));

    await act(async () => {
      await result.current.labelPeaks();
    });

    const anns = useApp.getState().annotations;
    expect(anns).toHaveLength(2);
    // Indistinguishable in SHAPE from a manually created annotation (MY RULING 1):
    // same keys as a plain addAnnotation() call, plus the optional groupId.
    const manualId = useApp.getState().addAnnotation(9, 9, "manual");
    const manual = useApp.getState().annotations.find((a) => a.id === manualId)!;
    for (const a of anns) {
      expect(Object.keys(a).sort()).toEqual(Object.keys({ ...manual, groupId: "x" }).sort());
    }
    const groupId = anns[0].groupId;
    expect(typeof groupId).toBe("string");
    expect(groupId).toBeTruthy();
    expect(anns[1].groupId).toBe(groupId);

    // Independent editability: patching one label never touches the other.
    const other = anns[1];
    useApp.getState().updateAnnotation(anns[0].id, { text: "edited by hand" });
    const after = useApp.getState().annotations.find((a) => a.id === other.id)!;
    expect(after).toEqual(other);
  });

  it("folds the whole run into exactly ONE undo entry — undo removes every label, redo restores them", async () => {
    vi.mocked(askParams).mockResolvedValue({ template: "{center}", precision: 2 });
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(2));
    const before = useApp.getState().history.length;

    await act(async () => {
      await result.current.labelPeaks();
    });

    expect(useApp.getState().annotations).toHaveLength(2); // N labels...
    expect(useApp.getState().history.length - before).toBe(1); // ...but ONE undo entry

    useApp.getState().undo();
    expect(useApp.getState().annotations).toHaveLength(0);

    useApp.getState().redo();
    expect(useApp.getState().annotations).toHaveLength(2);
  });
});

describe("usePeaks labelPeaks — MY RULING 4 (never mutates sources)", () => {
  it("never rewrites the dataset's DataStruct or the fit result — before labeling, and after editing/deleting a label", async () => {
    vi.mocked(fitMultiPeak).mockResolvedValue(fitted2(1.05, 3.05));
    vi.mocked(askParams).mockResolvedValue({ template: "{center}", precision: 2 });
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(2));
    await act(async () => {
      await result.current.fitTogether(OPTS);
    });

    const dataBefore = JSON.stringify(useApp.getState().datasets[0].data);
    const fitBefore = JSON.stringify(result.current.fitResult);

    await act(async () => {
      await result.current.labelPeaks();
    });

    expect(JSON.stringify(useApp.getState().datasets[0].data)).toBe(dataBefore);
    expect(JSON.stringify(result.current.fitResult)).toBe(fitBefore);

    const anns = useApp.getState().annotations;
    useApp.getState().updateAnnotation(anns[0].id, { text: "moved" });
    useApp.getState().removeAnnotation(anns[1].id);

    expect(JSON.stringify(useApp.getState().datasets[0].data)).toBe(dataBefore);
    expect(JSON.stringify(result.current.fitResult)).toBe(fitBefore);
  });
});

describe("usePeaks labelPeaks — MY RULING 5 (template tokens, unknown tokens, precision)", () => {
  it("renders a custom template, an unknown token literally, and honors precision", async () => {
    vi.mocked(askParams).mockResolvedValue({
      template: "peak {index}: {phase} {center}",
      precision: 1,
    });
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(2));

    await act(async () => {
      await result.current.labelPeaks();
    });

    const anns = useApp.getState().annotations as Annotation[];
    const texts = anns.map((a) => a.text).sort();
    expect(texts).toEqual(["peak 1: {phase} 1.0", "peak 2: {phase} 3.0"]);
  });
});

// A dataset whose own y-channel actually spans the backgrounded peaks'
// apex (~500-530) — round 2's L1 tests originally reused the tiny (~1-6)
// default `DATA` fixture while mocking a peak apex around 530, a mismatch
// the M2 y-range backstop (round 3) now correctly clamps against; a
// REALISTIC yRange (matching what the plotted channel actually contains)
// is what these tests need to isolate the height+bg formula itself.
const BACKGROUNDED_DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5],
  values: [[500], [530], [502], [525], [503], [500]],
  labels: ["I"],
  units: ["cps"],
  metadata: {},
};

describe("usePeaks labelPeaks — round-2 review: L1 CRITICAL apex y = height + bg", () => {
  it("detected peaks: label lands near the true apex (height + bg), not near height alone or zero", async () => {
    useApp.setState({ datasets: [{ id: "d1", name: "x.dat", data: BACKGROUNDED_DATA }], activeId: "d1" });
    // find_peaks_robust on a Gaussian riding a +500 DC offset: height=30, bg=500
    // (review's own repro) — true apex y is 530.
    vi.mocked(findPeaks).mockResolvedValue({
      peaks: [pk(1, 30, 0.8, 500), pk(3, 25, 0.9, 500)],
      background: [],
    });
    vi.mocked(askParams).mockResolvedValue({ template: "{center}", precision: 2 });
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(2));

    await act(async () => {
      await result.current.labelPeaks();
    });

    const anns = useApp.getState().annotations;
    expect(anns).toHaveLength(2);
    for (const a of anns) {
      expect(a.y).toBeGreaterThan(400); // near height+bg=530/525, nowhere near height (~30) or 0
    }
  });

  it("fitted peaks: label lands near the true apex (height + bg) too", async () => {
    useApp.setState({ datasets: [{ id: "d1", name: "x.dat", data: BACKGROUNDED_DATA }], activeId: "d1" });
    vi.mocked(fitMultiPeak).mockResolvedValue({
      peaks: [
        { center: 1, fwhm: 0.8, height: 30, bg: 500, eta: null, area: 4, status: "fitted(global)", model: "Lorentzian" },
        { center: 3, fwhm: 0.9, height: 25, bg: 500, eta: null, area: 5, status: "fitted(global)", model: "Lorentzian" },
      ],
      bgCoeffs: [500, 0],
      R2: 0.99,
      rmse: 0.5,
      nPeaks: 2,
      model: "Lorentzian",
    });
    vi.mocked(askParams).mockResolvedValue({ template: "{center}", precision: 2 });
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(2));
    await act(async () => {
      await result.current.fitTogether(OPTS);
    });

    await act(async () => {
      await result.current.labelPeaks();
    });

    const anns = useApp.getState().annotations;
    expect(anns).toHaveLength(2);
    for (const a of anns) {
      expect(a.y).toBeGreaterThan(400);
    }
  });
});

describe("usePeaks labelPeaks — round-2 review: L3 error handling", () => {
  it("a resolveDataset rejection surfaces as a toast and creates nothing, instead of failing silently", async () => {
    vi.mocked(askParams).mockResolvedValue({ template: "{center}", precision: 2 });
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(2));

    const original = useApp.getState().resolveDataset;
    useApp.setState({ resolveDataset: vi.fn().mockRejectedValue(new Error("network down")) });

    try {
      await act(async () => {
        await result.current.labelPeaks();
      });

      expect(useApp.getState().annotations).toHaveLength(0);
      expect(useToasts.getState().toasts.some((t) => t.kind === "danger")).toBe(true);
    } finally {
      useApp.setState({ resolveDataset: original }); // never leak the broken mock into later tests
    }
  });
});

describe("usePeaks labelPeaks — round-3 review: M4 silent abort after the dialog", () => {
  it("a resolveDataset that resolves to nothing (dataset vanished mid-dialog) toasts instead of returning silently", async () => {
    vi.mocked(askParams).mockResolvedValue({ template: "{center}", precision: 2 });
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(2));

    const original = useApp.getState().resolveDataset;
    useApp.setState({ resolveDataset: vi.fn().mockResolvedValue(undefined) });

    try {
      await act(async () => {
        await result.current.labelPeaks();
      });

      expect(useApp.getState().annotations).toHaveLength(0);
      expect(useToasts.getState().toasts.some((t) => t.kind === "danger")).toBe(true);
    } finally {
      useApp.setState({ resolveDataset: original });
    }
  });
});

describe("usePeaks labelPeaks — round-2 review: L4 precision clamp", () => {
  it("an out-of-range precision (e.g. 999) is clamped to a sane value instead of throwing RangeError", async () => {
    vi.mocked(askParams).mockResolvedValue({ template: "{center}", precision: 999 });
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(2));

    await act(async () => {
      await result.current.labelPeaks();
    });

    const anns = useApp.getState().annotations;
    expect(anns).toHaveLength(2); // clamped, not aborted
    for (const a of anns) {
      const decimals = a.text.includes(".") ? a.text.split(".")[1].length : 0;
      expect(decimals).toBeLessThanOrEqual(10);
    }
  });
});

describe("usePeaks labelPeaks — round-2 review: L5 nested-batch undo hole", () => {
  it("refuses to run (creates nothing, no dialog) while another history batch is already in flight", async () => {
    vi.mocked(askParams).mockResolvedValue({ template: "{center}", precision: 2 });
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(2));

    useApp.setState({ historySuppressed: true }); // simulates e.g. an in-flight "import as new version"

    await act(async () => {
      await result.current.labelPeaks();
    });

    expect(askParams).not.toHaveBeenCalled();
    expect(useApp.getState().annotations).toHaveLength(0);
  });
});

describe("usePeaks labelPeaks — round-6 review: P4 the L5 re-check must guard the resolveDataset await window too", () => {
  it("refuses to run when another history batch starts WHILE resolveDataset is in flight, not just before it", async () => {
    vi.mocked(askParams).mockResolvedValue({ template: "{center}", precision: 2 });
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(2));

    // Both pre-flight checks (before the dialog, and right after it) pass
    // clean — historySuppressed only flips true DURING the resolveDataset
    // await itself, simulating an import batch (relink.ts's
    // importChangedAsNewVersion) starting in that exact window.
    const original = useApp.getState().resolveDataset;
    useApp.setState({
      resolveDataset: vi.fn().mockImplementation(async (id: string) => {
        const ds = await original(id);
        useApp.setState({ historySuppressed: true });
        return ds;
      }),
    });

    try {
      await act(async () => {
        await result.current.labelPeaks();
      });

      // The batch guard closest to withHistoryBatch must catch this — no
      // annotation may be created and folded into the import's undo entry.
      expect(useApp.getState().annotations).toHaveLength(0);
    } finally {
      useApp.setState({ resolveDataset: original, historySuppressed: false });
    }
  });
});

describe("usePeaks labelPeaks — round-2 review: L7 blank labels", () => {
  it("a template that renders blank for every peak (e.g. {area} on detected peaks) creates nothing and toasts", async () => {
    vi.mocked(askParams).mockResolvedValue({ template: "{area}", precision: 2 });
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(2)); // area: null on every detected peak

    const before = useApp.getState().history.length;
    await act(async () => {
      await result.current.labelPeaks();
    });

    expect(useApp.getState().annotations).toHaveLength(0);
    expect(useApp.getState().history.length).toBe(before); // no empty undo entry
    expect(useToasts.getState().toasts.length).toBeGreaterThan(0);
  });

  it("skips only the blank-label peaks, keeping the rest", async () => {
    vi.mocked(findPeaks).mockResolvedValue({
      peaks: [
        { center: 1, height: 5, fwhm: 0.8, prominence: 1, localSNR: 10, area: 3, bg: 0 },
        { center: 3, height: 6, fwhm: 0.9, prominence: 1, localSNR: 10, area: null, bg: 0 },
      ],
      background: [],
    });
    vi.mocked(askParams).mockResolvedValue({ template: "{area}", precision: 2 });
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(2));

    await act(async () => {
      await result.current.labelPeaks();
    });

    const anns = useApp.getState().annotations;
    expect(anns).toHaveLength(1);
    expect(anns[0].text).toBe("3.00");
    expect(anns[0].x).toBe(1);
  });
});

describe("usePeaks labelPeaks — round-4 review: N3 placement uses the LIVE zoom (xLim/yLim), not the full data range", () => {
  it("with a narrow yLim set, the label lands inside it, not offset by a fraction of the full (much wider) data range", async () => {
    // The dataset's own y-channel spans a huge range (0-100000) — a 5%
    // offset of THAT would be ~5000, dwarfing any zoomed-in window and
    // landing the label off-canvas (annotationPlugin then silently skips
    // drawing it — the run "succeeds" with nothing visible).
    const WIDE_DATA: DataStruct = {
      time: [0, 1, 2, 3, 4, 5],
      values: [[0], [100000], [50000], [70000], [20000], [0]],
      labels: ["I"],
      units: ["cps"],
      metadata: {},
    };
    useApp.setState({
      datasets: [{ id: "d1", name: "x.dat", data: WIDE_DATA }],
      activeId: "d1",
      yLim: [500, 600], // the user has zoomed into a narrow window around the peak
    });
    vi.mocked(findPeaks).mockResolvedValue({
      peaks: [pk(1, 30, 0.8, 500)], // apex = height + bg = 530, inside yLim
      background: [],
    });
    vi.mocked(askParams).mockResolvedValue({ template: "{center}", precision: 2 });
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(1));

    await act(async () => {
      await result.current.labelPeaks();
    });

    const anns = useApp.getState().annotations;
    expect(anns).toHaveLength(1);
    expect(anns[0].y).toBeGreaterThanOrEqual(500);
    expect(anns[0].y).toBeLessThanOrEqual(600); // inside the zoomed yLim, not off in the full 0-100000 range
  });

  it("falls back to the full data range when xLim/yLim are null (autoscale, unchanged behavior)", async () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "x.dat", data: BACKGROUNDED_DATA }],
      activeId: "d1",
      xLim: null,
      yLim: null,
    });
    vi.mocked(findPeaks).mockResolvedValue({
      peaks: [pk(1, 30, 0.8, 500)],
      background: [],
    });
    vi.mocked(askParams).mockResolvedValue({ template: "{center}", precision: 2 });
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(1));

    await act(async () => {
      await result.current.labelPeaks();
    });

    const anns = useApp.getState().annotations;
    expect(anns).toHaveLength(1);
    expect(anns[0].y).toBeGreaterThan(400); // same as the L1 test — autoscale unaffected
  });
});

describe("usePeaks labelPeaks — round-5 review: O3 passes the live yScale through to placement", () => {
  it("on a log-scaled view, a weak peak's label stays a sensible LOG-SPACE distance above it, not a huge linear offset", async () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "x.dat", data: BACKGROUNDED_DATA }],
      activeId: "d1",
      yLim: [1, 100000], // a log-relevant range (matches the pure-fn O3 tests)
      yScale: "log",
    });
    vi.mocked(findPeaks).mockResolvedValue({
      peaks: [pk(1, 10, 0.8, 0)], // apex = 10, a weak peak near the log range's bottom
      background: [],
    });
    vi.mocked(askParams).mockResolvedValue({ template: "{center}", precision: 2 });
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(1));

    await act(async () => {
      await result.current.labelPeaks();
    });

    const anns = useApp.getState().annotations;
    expect(anns).toHaveLength(1);
    expect(anns[0].y).toBeGreaterThan(10); // above its own apex
    // A plain LINEAR 5%-of-range offset would be ~5010 (10 + 0.05*99999) —
    // the exact bug O3 describes. A log-aware offset stays close to 10.
    expect(anns[0].y).toBeLessThan(100);
  });
});

describe("usePeaks labelPeaks — round-6 review: P3 a non-positive sample no longer disables the log transform on autoscale", () => {
  it("a dataset with one non-positive sample still gets log-spaced offsets on autoscale (yLim: null)", async () => {
    // A routine XRD case: a slightly negative/zero background sample
    // alongside real (positive) intensities spanning several decades.
    const DATA_WITH_NEGATIVE_SAMPLE: DataStruct = {
      time: [0, 1, 2, 3, 4, 5],
      values: [[-5], [10], [100], [1000], [10000], [100000]],
      labels: ["I"],
      units: ["cps"],
      metadata: {},
    };
    useApp.setState({
      datasets: [{ id: "d1", name: "x.dat", data: DATA_WITH_NEGATIVE_SAMPLE }],
      activeId: "d1",
      yLim: null, // autoscale — finiteRange(y) must do the positive-only filtering itself
      yScale: "log",
    });
    vi.mocked(findPeaks).mockResolvedValue({
      peaks: [pk(1, 10, 0.8, 0)], // apex = 10, the smallest POSITIVE sample
      background: [],
    });
    vi.mocked(askParams).mockResolvedValue({ template: "{center}", precision: 2 });
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(1));

    await act(async () => {
      await result.current.labelPeaks();
    });

    const anns = useApp.getState().annotations;
    expect(anns).toHaveLength(1);
    expect(anns[0].y).toBeGreaterThan(10); // above its own apex
    // If the -5 sample had disabled the log transform (finiteRange(y)[0]
    // <= 0 -> the range fails to transform -> whole call reverts to
    // linear), the offset would be ~5000 (5% of a ~100005-wide range) —
    // the exact bug this finding describes. A log-aware offset, using the
    // smallest POSITIVE sample (10) as the floor instead of -5, stays
    // close to the apex.
    expect(anns[0].y).toBeLessThan(100);
  });
});
