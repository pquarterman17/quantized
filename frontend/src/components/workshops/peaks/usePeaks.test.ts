import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { findPeaks, fitMultiPeak, fitPeak } from "../../../lib/api/peaks";
import { fetchBookData } from "../../../lib/api";
import { askParams } from "../../overlays/ParamDialog";
import type { Annotation, DataStruct, MultiFitResult, Peak, SinglePeakFit } from "../../../lib/types";
import { usePendingOps } from "../../../store/pendingOps";
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

function pk(center: number, height: number, fwhm: number): Peak {
  return { center, height, fwhm, prominence: 1, localSNR: 10, area: null };
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
