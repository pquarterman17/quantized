// Reflectivity fit on the workbench shell's out-of-date contract (lane WB5).
// The fit stays a button with its own AbortController. Its live result is
// stamped with the bindings, data settings, parameter table, graded layers and
// bound data it was LAUNCHED with; once any moves it is marked, its curve leaves
// the plot, and nothing applies, adds, plots or reports it as current. Applying
// the fitted values re-bases the stamp (the intended move of the start values).

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { reflFit, reflPresets, type ReflFitResult } from "../../../lib/api/reflectivity";
import type { Dataset, SldPreset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { makePending, restoreResolve } from "../workbench/pendingBook.testkit";
import { useReflFit } from "./useReflFit";
import { useReflectivity } from "./useReflectivity";

vi.mock("uplot", async () => ({ default: (await import("./reflFit.testkit")).UPlotStub }));
vi.mock("../../../lib/api/reflectivity", () => ({
  reflPresets: vi.fn(), reflSimulate: vi.fn(), reflSldProfile: vi.fn(), reflFit: vi.fn(),
}));

const PRESETS: SldPreset[] = [
  { name: "Air / Vacuum", formula: "", sldX: 0, sldN: 0, sldImag: 0, density: 0 },
  { name: "Nickel", formula: "Ni", sldX: 7.18e-5, sldN: 9.4e-6, sldImag: 5e-7, density: 8.9 },
  { name: "Silicon", formula: "Si", sldX: 2.007e-5, sldN: 2.073e-6, sldImag: 0, density: 2.33 },
  { name: "Silicon Oxide", formula: "SiO2", sldX: 1.888e-5, sldN: 3.47e-6, sldImag: 0, density: 2.2 },
];
const Q = [0.01, 0.02, 0.03, 0.04, 0.05, 0.06];
const XRR: Dataset = {
  id: "xrr", name: "film.refl",
  data: {
    time: Q, values: Q.map((q, i) => [1 / (1 + 100 * q * i), 0.01, 1e-4]),
    labels: ["Intensity", "uncertainty", "resolution"], units: ["arb. units", "arb. units", "1/Ang"], metadata: { x_column_unit: "1/Ang" },
  },
  errorRoles: [{ channel: 1, target: 0, axis: "y", side: "both" }, { channel: 2, target: -1, axis: "x", side: "both" }],
} as Dataset;

const FIT: ReflFitResult = {
  parameters: [
    { name: "L1.thickness", value: 187.5, stderr: 0.8, vary: true, tie: null, at_bound: false },
    { name: "scale", value: 0.97, stderr: 0.01, vary: true, tie: null, at_bound: false },
  ],
  free: ["L1.thickness", "scale"], correlation: [], chi2: 12, reduced_chi2: 1.25, sum_sq_log: null, reduced_sum_sq_log: null,
  n_points: 6, n_free: 2, success: true, message: "ok", n_evaluations: 42, weighting: "dr",
  curves: [{ label: "c", spin: null, q: [0.01, 0.03, 0.05], r: [1, 0.5, 0.2], dr: [0.01, 0.01, 0.01], model: [0.9, 0.4, 0.1], residual: [] }],
  sld_profiles: [{ spin: null, z: [-10, 0, 10], sld: [0, 7e-5, 2e-5] }], warnings: [],
};

function useBoth() {
  const refl = useReflectivity();
  const fit = useReflFit(refl);
  return { refl, fit };
}
async function mountHook() {
  const view = renderHook(() => useBoth());
  await waitFor(() => expect(view.result.current.refl.presets).toHaveLength(PRESETS.length));
  return view;
}
async function fitted() {
  const view = await mountHook();
  await act(async () => { await view.result.current.fit.run(); });
  expect(view.result.current.fit.result).not.toBeNull();
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  restoreResolve();
  vi.mocked(reflPresets).mockResolvedValue({ presets: PRESETS });
  vi.mocked(reflFit).mockResolvedValue(FIT);
  useApp.setState({ datasets: [XRR], activeId: "xrr", status: "", fitOverlay: null, reflectivitySeed: null });
});

describe("useReflFit out of date", () => {
  it("characterization: a fresh fit is current, drawn, and a rename of the dataset is not an input", async () => {
    const { result } = await fitted();
    expect(result.current.fit.stale).toBe(false);
    expect(useApp.getState().fitOverlay?.datasetId).toBe("xrr");
    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, name: "renamed.refl" })) })));
    expect(result.current.fit.stale).toBe(false);
  });

  it("a parameter, data setting or binding change marks it, takes its curve off the plot and withholds the outputs", async () => {
    const { result } = await fitted();
    act(() => result.current.fit.setParam("L1.thickness", { vary: true }));
    expect(result.current.fit.stale).toBe(true);
    await waitFor(() => expect(useApp.getState().fitOverlay).toBeNull());
    expect(result.current.fit.applyBlocked).toMatch(/out of date/);
    expect(result.current.fit.addCurves()).toEqual([]);
    expect(result.current.fit.curvesAdded).toBe(false);
    act(() => result.current.fit.setParam("L1.thickness", { vary: false }));
    expect(result.current.fit.stale).toBe(false);

    act(() => result.current.fit.setSettings({ weighting: "log" }));
    expect(result.current.fit.stale).toBe(true);
    act(() => result.current.fit.setSettings({ weighting: "dr" }));
    expect(result.current.fit.stale).toBe(false);

    act(() => result.current.fit.setChannel(0, { drCol: null }));
    expect(result.current.fit.stale).toBe(true);
  });

  it("an edit to the bound dataset's rows marks it", async () => {
    const { result } = await fitted();
    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, excludedRows: [1] })) })));
    expect(result.current.fit.stale).toBe(true);
  });

  it("applying the fitted values does not make the fit out of date (the stamp is re-based)", async () => {
    const { result } = await fitted();
    act(() => result.current.fit.applyToModel());
    expect(result.current.fit.stale).toBe(false);
    // ...but an edit after the apply does.
    act(() => result.current.fit.setParam("scale", { vary: true }));
    expect(result.current.fit.stale).toBe(true);
  });

  it("running again clears the mark and draws the new fit", async () => {
    const { result } = await fitted();
    act(() => result.current.fit.setParam("L1.thickness", { vary: true }));
    await act(async () => { await result.current.fit.run(); });
    expect(result.current.fit.stale).toBe(false);
    expect(useApp.getState().fitOverlay?.datasetId).toBe("xrr");
  });

  it("forced race: a parameter edited while the fit runs leaves the landed fit out of date and undrawn", async () => {
    let land!: (r: ReflFitResult) => void;
    let began!: () => void;
    const started = new Promise<void>((r) => { began = r; });
    vi.mocked(reflFit).mockImplementationOnce(() => { began(); return new Promise((r) => { land = r as never; }); });
    const { result } = await mountHook();
    let p!: Promise<void>;
    act(() => { p = result.current.fit.run(); });
    await started;
    act(() => result.current.fit.setParam("L1.thickness", { vary: true }));
    await act(async () => { land(FIT); await p; });
    expect(result.current.fit.result).not.toBeNull();
    expect(result.current.fit.stale).toBe(true);
    await waitFor(() => expect(useApp.getState().fitOverlay).toBeNull());
  });

  it("a lazy book is resolved before the run is stamped: the landed fit is current", async () => {
    makePending(XRR);
    const { result } = await fitted();
    expect(result.current.fit.stale).toBe(false);
  });
});
