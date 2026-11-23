// "Open in Film thickness (FFT) / Reflectivity FFT" (OPEN_ITEMS row 12): the
// recorded settings AND the column they ran on come back exactly; a result
// saved before they were recorded, a deleted source and a changed column set
// all fail closed (nothing seeded, Replace off, the reason shown).

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalysisResultValue } from "../../../lib/analysisResult";
import { planReopen } from "../../../lib/committedOutputReopen";
import type { DataStruct } from "../../../lib/types";
import { useToolReopen } from "../../../store/toolReopen";
import { openCommittedResultInTool } from "../../../store/toolReopenOpen";
import { useApp } from "../../../store/useApp";
import { useFftThickness } from "../reductions/useFftThickness";
import { useReflectivityFft } from "../reductions/useReflectivityFft";

const { fftMock, reflMock } = vi.hoisted(() => ({ fftMock: vi.fn(), reflMock: vi.fn() }));
vi.mock("../../../lib/api/reductions", () => ({ fftThickness: fftMock, reflectivityFft: reflMock }));

const scan = (labels: string[]): DataStruct => ({
  time: [10, 20, 30, 40], values: [[1, 5], [2, 6], [3, 7], [4, 8]], labels, units: ["", ""], metadata: {},
});
const reset = (labels = ["Intensity", "Monitor"]) => useApp.setState({
  datasets: [{ id: "src", name: "scan.dat", data: scan(labels) }], activeId: "src", status: "", analysisResults: [],
  history: [], future: [], staleDatasets: [], staleFits: [], recalcMode: "manual", reductionsOpen: false,
});

beforeEach(() => {
  vi.clearAllMocks();
  fftMock.mockResolvedValue({
    thickness_nm: 55.5, uncertainty_nm: null, wavelength_a: 1.789, two_theta_range: [20, 80],
    fft_magnitude: [0, 1, 2], thickness_axis: [0, 10, 20], n_points: 4,
  });
  reflMock.mockResolvedValue({
    thicknesses_nm: [30], amplitudes: [1], harmonic_labels: [""], q_range: [0, 1], preprocess: "RQ4",
    fft_magnitude: [0, 1], thickness_axis: [0, 10], is_neutron: true,
    superlattice: { detected: false, bilayer_period_nm: null, total_thickness_nm: null, n_repeats: null, sublayer_a_nm: null, sublayer_b_nm: null, suppressed_orders: [] },
  });
  useToolReopen.setState({ sessions: {} });
  reset();
});

const results = () => useApp.getState().analysisResults;
const sessionOf = (tool: string) => useToolReopen.getState().sessions[tool]!;

interface Writer {
  tool: string;
  /** Run once with non-default settings and add the output; returns the settings it ran with. */
  commitOnce: () => Promise<unknown>;
  /** Mount the tool's state hook and read every setting it starts from. */
  read: () => Record<string, unknown>;
  /** What a plain open (no reopen) starts from. */
  defaults: Record<string, unknown>;
  expected: Record<string, unknown>;
}

const fft: Writer = {
  tool: "fft-thickness",
  expected: { col: 1, wavelength: 1.789, twoThetaMin: 20, twoThetaMax: 80, windowFn: "blackman", maxThicknessNm: 150 },
  defaults: { col: 0, wavelength: 1.5406, twoThetaMin: null, twoThetaMax: null, windowFn: "hann", maxThicknessNm: 200 },
  async commitOnce() {
    const hook = renderHook(() => useFftThickness());
    act(() => {
      hook.result.current.setCol(1); hook.result.current.setWavelength(1.789);
      hook.result.current.setTwoThetaMin(20); hook.result.current.setTwoThetaMax(80);
      hook.result.current.setWindowFn("blackman"); hook.result.current.setMaxThicknessNm(150);
    });
    await act(async () => { await hook.result.current.compute(); });
    act(() => hook.result.current.toLibrary());
    hook.unmount();
  },
  read() {
    const { result } = renderHook(() => useFftThickness());
    const { col, wavelength, twoThetaMin, twoThetaMax, windowFn, maxThicknessNm } = result.current;
    return { col, wavelength, twoThetaMin, twoThetaMax, windowFn, maxThicknessNm };
  },
};

const refl: Writer = {
  tool: "reflectivity-fft",
  expected: { col: 1, isNeutron: false, wavelength: 1.789, xMin: 0.02, xMax: null, windowFn: "none", preprocess: "RQ4", maxThicknessNm: 321, peakProminence: 0.2 },
  // The x axis here (10..40) is not Q, so a plain open is XRR.
  defaults: { col: 0, isNeutron: false, wavelength: 1.5406, xMin: null, xMax: null, windowFn: "hann", preprocess: "logR", maxThicknessNm: 500, peakProminence: 0.05 },
  async commitOnce() {
    const hook = renderHook(() => useReflectivityFft());
    act(() => {
      hook.result.current.setCol(1); hook.result.current.setWavelength(1.789); hook.result.current.setXMin(0.02);
      hook.result.current.setWindowFn("none"); hook.result.current.setPreprocess("RQ4");
      hook.result.current.setMaxThicknessNm(321); hook.result.current.setPeakProminence(0.2);
    });
    await act(async () => { await hook.result.current.compute(); });
    act(() => hook.result.current.toLibrary());
    hook.unmount();
  },
  read() {
    const { result } = renderHook(() => useReflectivityFft());
    const { col, isNeutron, wavelength, xMin, xMax, windowFn, preprocess, maxThicknessNm, peakProminence } = result.current;
    return { col, isNeutron, wavelength, xMin, xMax, windowFn, preprocess, maxThicknessNm, peakProminence };
  },
};

describe.each([fft, refl])("Open in $tool", (w) => {
  it("restores the exact recorded settings and column, with Replace preselected", async () => {
    // Characterization: a plain open starts from the defaults (so the restore below is the change).
    expect(w.read()).toEqual(w.defaults);
    await w.commitOnce();
    expect(results()).toHaveLength(1);
    act(() => { expect(openCommittedResultInTool(results()[0]!.id)).toBe(true); });
    expect(useApp.getState().reductionsOpen).toBe(true);
    expect(useApp.getState().reductionsMethod).toBe(w.tool);
    expect(w.read()).toEqual(w.expected);
    expect(sessionOf(w.tool).mode).toBe("replace");
  });

  it("an old result without the recorded settings refuses with the existing reason", async () => {
    await w.commitOnce();
    const old = { ...results()[0]!, producer: { ...results()[0]!.producer, version: 1 } };
    const plan = planReopen(old, useApp.getState().datasets);
    expect(plan.ok).toBe(false);
    expect(!plan.ok && plan.reason).toMatch(/saved before its settings were recorded, so it cannot be reopened/);
    useApp.setState({ analysisResults: [old] });
    act(() => { expect(openCommittedResultInTool(old.id)).toBe(false); });
    expect(useApp.getState().reductionsOpen).toBe(false);
    expect(useToolReopen.getState().sessions[w.tool]).toBeUndefined();
  });

  it("the recorded settings stay outside identity: the key ignores them and an identical re-run matches a v1 result", async () => {
    await w.commitOnce();
    const v2 = results()[0]!;
    // A result saved before this change: producer v1, no recorded reopen extra.
    const { extra: _gone, ...reopen } = v2.parameters!["reopen"] as Record<string, unknown>;
    const v1 = { ...v2, producer: { ...v2.producer, version: 1 }, parameters: { ...v2.parameters, reopen: reopen as AnalysisResultValue } };
    useApp.setState({ analysisResults: [v1] });
    const keyBefore = v2.parameters!["commitKey"];
    // The recorded column picks live beside the keyed settings, never in them (a v1 key has none).
    expect(String(keyBefore)).not.toContain("picks");
    await w.commitOnce();
    // The same computation: no second result, and the stored key is unchanged.
    expect(results()).toHaveLength(1);
    expect(results()[0]!.parameters!["commitKey"]).toBe(keyBefore);
  });

  it("a v2 result whose column picks are missing opens WITHOUT settings and cannot replace", async () => {
    await w.commitOnce();
    useApp.setState((s) => ({
      analysisResults: s.analysisResults.map((r) => {
        const { extra: _gone, ...reopen } = r.parameters!["reopen"] as Record<string, unknown>;
        return { ...r, parameters: { ...r.parameters, reopen: reopen as AnalysisResultValue } };
      }),
    }));
    act(() => { expect(openCommittedResultInTool(results()[0]!.id)).toBe(true); });
    expect(sessionOf(w.tool).seed).toBeNull();
    expect(sessionOf(w.tool).notice).toContain("were not recorded");
    expect(sessionOf(w.tool).mode).toBe("new");
    expect(w.read()).toEqual(w.defaults);
  });

  it("a deleted source opens WITHOUT settings and cannot replace", async () => {
    await w.commitOnce();
    act(() => useApp.setState((s) => ({ datasets: s.datasets.filter((d) => d.id !== "src") })));
    act(() => { expect(openCommittedResultInTool(results()[0]!.id)).toBe(true); });
    expect(sessionOf(w.tool).seed).toBeNull();
    expect(sessionOf(w.tool).sourceId).toBeNull();
    expect(sessionOf(w.tool).notice).toMatch(/no longer exists/);
    expect(sessionOf(w.tool).mode).toBe("new");
    expect(w.read()).toEqual(w.defaults);
  });

  it("a changed column set is NOT guessed: no settings, the reason shown, Replace off", async () => {
    await w.commitOnce();
    // The recorded column (index 1, "Monitor") is now another column.
    act(() => useApp.setState((st) => ({
      datasets: st.datasets.map((d) => ({ ...d, data: { ...d.data, labels: ["Intensity", "Temperature"] } })),
    })));
    act(() => { expect(openCommittedResultInTool(results()[0]!.id)).toBe(true); });
    const session = sessionOf(w.tool);
    expect(session.seed).toBeNull();
    expect(session.extra).toBeNull();
    expect(session.notice).toContain("“Monitor” is no longer at its place in “scan.dat”");
    expect(session.replaceBlocked).toContain("“Monitor”");
    expect(session.mode).toBe("new");
    expect(w.read()).toEqual(w.defaults);
  });
});
