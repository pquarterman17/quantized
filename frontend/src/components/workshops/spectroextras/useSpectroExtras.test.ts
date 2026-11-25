// Spectroscopy extras hook: Run is explicit, a result lives only while the spectra and settings
// match, bad input is refused before any request, and commits follow the result-lifecycle contract.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useSpectroExtras } from "./useSpectroExtras";

const api = vi.hoisted(() => ({ spectroFsd: vi.fn(), spectroCorr2d: vi.fn(), spectroOnset: vi.fn() }));
vi.mock("../../../lib/api/spectroExtras", () => api);

const N = 24;
const x = Array.from({ length: N }, (_, i) => i * 0.5);
const data = (cols: number): DataStruct => ({
  time: x, values: x.map((v, i) => Array.from({ length: cols }, (_, c) => Math.sin(i / 3) + c + v)),
  labels: Array.from({ length: cols }, (_, c) => `s${c}`), units: Array.from({ length: cols }, () => ""), metadata: { x_column_name: "k" },
});
const map = (name: string): DataStruct => ({ time: [0, 1, 2, 3], values: [[0, 0, name === "sync" ? 1 : -1], [1, 0, 2], [0, 1, 3], [1, 1, 4]], labels: ["k 1", "k 2", "Intensity"], units: ["", "", ""], metadata: { is2D: true, map_shape: [2, 2], name } });
const FSD = (n = N) => ({ y: Array.from({ length: n }, (_, i) => i), info: { apodization: "triangular", hwhm: 1, k: 1.5, cutoff: 0.5, k_max: 3, fwhm_in: 2, fwhm_out: 1.3, noise_gain: 4 } });
const outputs = () => useApp.getState().datasets.filter((d) => d.id !== "d1");

function load(cols: number) {
  useApp.setState({ datasets: [{ id: "d1", name: "spec.dat", data: data(cols) }], activeId: "d1", status: "", analysisResults: [],
    history: [], future: [], staleDatasets: [], staleFits: [], recalcMode: "manual" });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.spectroFsd.mockImplementation(async () => FSD());
  api.spectroCorr2d.mockResolvedValue({ synchronous: map("sync"), asynchronous: map("async"), info: { spectra: 3, points: 2, reference: [1, 2], x: [0, 1] } });
  load(3);
});

describe("useSpectroExtras", () => {
  it("sends nothing until Run, then one request per ticked column", async () => {
    const { result } = renderHook(() => useSpectroExtras());
    expect(api.spectroFsd).not.toHaveBeenCalled();
    expect(result.current.picked).toEqual([0, 1, 2]);
    await act(async () => { await result.current.run(); });
    expect(api.spectroFsd).toHaveBeenCalledTimes(3);
    expect(api.spectroFsd.mock.calls[0][0]).toMatchObject({ x, hwhm: 1, k: 1.5, apodization: "triangular" });
    expect(result.current.result?.tab).toBe("fsd");
    expect(result.current.figures).toHaveLength(1);
  });

  it("marks a result stale when a setting or a tick changes", async () => {
    const { result } = renderHook(() => useSpectroExtras());
    await act(async () => { await result.current.run(); });
    act(() => result.current.patch("fsd", { k: 2 }));
    expect(result.current.result).toBeNull();
    expect(result.current.stale).toBe(true);
    act(() => result.current.patch("fsd", { k: 1.5 }));
    expect(result.current.result?.tab).toBe("fsd");
    act(() => result.current.toggle(2));
    expect(result.current.result).toBeNull();
  });

  it("refuses an uneven X before any request", async () => {
    const d = data(1);
    d.time = d.time.map((v, i) => (i === 6 ? v + 0.2 : v));
    useApp.setState({ datasets: [{ id: "d1", name: "spec.dat", data: d }] });
    const { result } = renderHook(() => useSpectroExtras());
    expect(result.current.problem).toMatch(/evenly spaced/);
    await act(async () => { await result.current.run(); });
    expect(api.spectroFsd).not.toHaveBeenCalled();
  });

  it("shows the backend's refusal and drops the old result", async () => {
    const { result } = renderHook(() => useSpectroExtras());
    await act(async () => { await result.current.run(); });
    api.spectroFsd.mockRejectedValue(new Error("K = 9 is too large for this sampling"));
    act(() => result.current.patch("fsd", { k: 2 }));
    await act(async () => { await result.current.run(); });
    expect(result.current.error).toMatch(/too large/);
    expect(result.current.result).toBeNull();
  });

  it("commits FSD as one linked worksheet, and a repeat adds nothing", async () => {
    const { result } = renderHook(() => useSpectroExtras());
    await act(async () => { await result.current.run(); });
    act(() => result.current.commit());
    expect(outputs()).toHaveLength(1);
    expect(outputs()[0].data.labels).toEqual(["s0 · FSD", "s1 · FSD", "s2 · FSD"]);
    expect(useApp.getState().analysisResults).toHaveLength(1);
    act(() => result.current.commit());
    expect(outputs()).toHaveLength(1);
    expect(result.current.done).toMatch(/already added/);
  });

  it("2-D correlation commits the synchronous and asynchronous maps as two worksheets", async () => {
    const { result } = renderHook(() => useSpectroExtras());
    act(() => result.current.setTab("corr2d"));
    act(() => result.current.patch("corr", { perturbation: "300, 310, 320" }));
    await act(async () => { await result.current.run(); });
    expect(api.spectroCorr2d.mock.calls[0][0]).toMatchObject({ x, perturbation: [300, 310, 320], x_label: "k" });
    expect(api.spectroCorr2d.mock.calls[0][0].spectra).toHaveLength(3);
    act(() => result.current.commit());
    expect(outputs().map((d) => d.name)).toEqual(["spec · 2D synchronous", "spec · 2D asynchronous"]);
    expect(outputs()[0].data.metadata.is2D).toBe(true);
    act(() => result.current.commit());
    expect(outputs()).toHaveLength(2);
  });

  it("onset commits the windowed signal with its baseline and tangent", async () => {
    const wx = x.slice(4, 20);
    api.spectroOnset.mockImplementation(async () => ({
      side: "left", x: wx, baseline_line: wx.map(() => 0), tangent_line: wx.map((v) => v - 3),
      baseline: { slope: 0, intercept: 0, lo: 2, hi: 3 }, top: { x: 8, y: 5, height: 5 },
      tangent: { x_onset: 3, y_onset: 0, slope: 1, x_steepest: 5, y_steepest: 2 }, threshold: { x_onset: 3.5, y_onset: 0.5, fraction: 0.1, level: 0.5 },
    }));
    load(1);
    const { result } = renderHook(() => useSpectroExtras());
    act(() => result.current.setTab("onset"));
    await act(async () => { await result.current.run(); });
    expect(result.current.figures).toHaveLength(1);
    act(() => result.current.commit());
    expect(outputs()[0].data.labels).toEqual(["s0", "s0 · baseline", "s0 · tangent"]);
    expect(outputs()[0].data.time).toEqual(wx);
  });
});
