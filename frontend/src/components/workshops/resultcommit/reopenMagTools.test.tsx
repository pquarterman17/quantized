// "Open in Units / Internal field / Curie–Weiss" (lane RO3): each Magnetometry
// tab records its settings (producer version 2), reopens on the recorded source
// with them restored, REPLACES its output in one undo step (same output and
// result id) or adds a new one, and refuses, with the reason, a result saved
// before the settings were recorded.

import { act, render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { demagCorrectField } from "../../../lib/api/magnetometry";
import { magneticCurieWeissDataFit, type CurieWeissDataFitResult } from "../../../lib/api/magnetic";
import { normalizeMagMoment } from "../../../lib/api/magnetometry";
import type { Dataset } from "../../../lib/types";
import { useToolReopen } from "../../../store/toolReopen";
import { openCommittedResultInTool } from "../../../store/toolReopenOpen";
import { useApp } from "../../../store/useApp";
import MagToolsPanel from "../magtools/MagToolsPanel";
import { useCurieWeiss } from "../magtools/useCurieWeiss";
import { useDemagCorrection } from "../magtools/useDemagCorrection";
import { useMagNormalization } from "../magtools/useMagNormalization";

vi.mock("../../../lib/api/magnetometry", () => ({
  subtractMagBackground: vi.fn(), subtractHysteresisBackground: vi.fn(), normalizeMagMoment: vi.fn(), demagCorrectField: vi.fn(),
}));
vi.mock("../../../lib/api/magnetic", () => ({ magneticCurieWeissDataFit: vi.fn() }));

const realResolveDataset = useApp.getState().resolveDataset;
const outputs = () => useApp.getState().datasets.filter((d) => d.id !== "src");
const results = () => useApp.getState().analysisResults;
const resultId = () => results()[0]!.id;
const session = (tool: string) => useToolReopen.getState().sessions[tool]!;

function load(source: Dataset): void {
  useToolReopen.setState({ sessions: {} });
  useApp.setState({
    datasets: [source], activeId: "src", xKey: null, yKeys: null, seriesOrder: null, status: "", analysisResults: [],
    history: [], future: [], staleDatasets: [], staleFits: [], recalcMode: "manual", magToolsOpen: false,
    savedSampleProfiles: [], resolveDataset: realResolveDataset,
  });
}

/** The generic contract every tab must meet once it has committed one result. */
function contract(tool: string, label: string) {
  it("records producer version 2, the settings and the channels it ran on", () => {
    const result = results()[0]!;
    expect(result.producer.version).toBe(2);
    expect(result.parameters!["settings"]).toMatchObject({ xKey: null, yKey: 0 });
    const reopen = result.parameters!["reopen"] as { extra: { channels: { yLabel: string; yIndex: number } } };
    expect(reopen.extra.channels).toMatchObject({ yIndex: 0 });
    expect(reopen.extra.channels.yLabel).not.toBe("");
  });

  it("a result saved before the settings were recorded refuses with a one-sentence reason", () => {
    useApp.setState((s) => ({ analysisResults: s.analysisResults.map((r) => ({ ...r, producer: { ...r.producer, version: 1 } })) }));
    act(() => { expect(openCommittedResultInTool(resultId())).toBe(false); });
    expect(useApp.getState().status).toContain(`Open in ${label}`);
    expect(useApp.getState().status).toContain("saved before its settings were recorded, so it cannot be reopened");
    expect(useToolReopen.getState().sessions[tool]).toBeUndefined();
    expect(useApp.getState().magToolsOpen).toBe(false);
  });

  it("a deleted source opens the tool with no settings, a notice and no Replace", () => {
    useApp.setState((s) => ({ datasets: s.datasets.filter((d) => d.id !== "src") }));
    act(() => { expect(openCommittedResultInTool(resultId())).toBe(true); });
    expect(session(tool).seed).toBeNull();
    expect(session(tool).sourceId).toBeNull();
    expect(session(tool).notice).toContain("no longer exists");
    expect(session(tool).mode).toBe("new");
  });
}

// ---------------------------------------------------------------- Units

const curve = (): Dataset => ({
  id: "src", name: "film.dat",
  data: {
    time: [-1000, 0, 1000], values: [[-1.5e-3], [0], [1.5e-3]], labels: ["Moment"], units: ["emu"],
    metadata: { x_column_name: "Magnetic Field", x_column_unit: "Oe" },
  },
});
const fakeBackend = (factor: number) => async (b: Parameters<typeof normalizeMagMoment>[0]) => ({
  x: b.x, y: b.y.map((v) => v * factor), x_unit: b.to_field, y_unit: b.to_moment, warning: "",
  basis: b.basis, geometry: b.geometry, factor, divisor: 1, divisor_unit: "cm³", mass_g: null, area_cm2: 25, volume_cm3: 7.5e-5,
  canonical: { width: 5, length: 5, film_thickness: 3e-6 }, equation: "eq", geometry_equation: "geq",
});

async function applyUnits(thickness: string): Promise<void> {
  const hook = renderHook(() => useMagNormalization());
  act(() => hook.result.current.setBasis("volume"));
  act(() => hook.result.current.setGeometry("rectangle"));
  act(() => hook.result.current.setFieldText("width", "5"));
  act(() => hook.result.current.setFieldText("length", "5"));
  act(() => hook.result.current.setFieldText("filmThickness", thickness));
  act(() => hook.result.current.setToMoment("A/m"));
  await act(async () => { await hook.result.current.apply(); });
  hook.unmount();
}

describe("Units: reopen, adjust, replace", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(normalizeMagMoment).mockImplementation(fakeBackend(2));
    load(curve());
    await applyUnits("30");
    expect(outputs()).toHaveLength(1);
  });
  contract("mag-normalization", "Units");

  it("records the geometry beside the profile", () => {
    expect(results()[0]!.parameters!["settings"]).toMatchObject({ basis: "volume", geometry: "rectangle", toMoment: "A/m" });
  });

  it("reopens with the recorded basis, geometry, profile and output unit, Replace preselected", () => {
    act(() => { expect(openCommittedResultInTool(resultId())).toBe(true); });
    expect(useApp.getState().magToolsOpen).toBe(true);
    const { result } = renderHook(() => useMagNormalization());
    expect(result.current.basis).toBe("volume");
    expect(result.current.profile.geometry).toBe("rectangle");
    expect(result.current.texts).toMatchObject({ width: "5", length: "5", filmThickness: "30" });
    expect(result.current.profile.filmThickness.unit).toBe("nm");
    expect(result.current.toMoment).toBe("A/m");
    expect(session("mag-normalization").mode).toBe("replace");
  });

  it("plots the channel the result ran on, as one undo step, and says so", () => {
    const before = useApp.getState().history.length;
    act(() => { openCommittedResultInTool(resultId()); });
    expect(useApp.getState().yKeys).toEqual([0]);
    expect(useApp.getState().history.length).toBe(before + 1);
    expect(useApp.getState().status).toContain("the channel this result ran on");
  });

  it("an unreadable recorded profile is not guessed: the form starts empty and Replace is off until it is set", () => {
    useApp.setState((s) => ({
      analysisResults: s.analysisResults.map((r) => ({ ...r, parameters: { ...r.parameters, settings: { ...(r.parameters!["settings"] as object), geometry: "blob" } } })),
    }));
    act(() => { openCommittedResultInTool(resultId()); });
    const { result } = renderHook(() => useMagNormalization());
    expect(result.current.seedProblem).toContain("could not be restored");
    expect(result.current.basis).toBe("none");
    expect(session("mag-normalization").mode).toBe("new");
    act(() => result.current.setBasis("volume"));
    expect(result.current.seedProblem).toBeNull();
  });

  it("Replace rewrites the output in ONE undo step, keeping its id and the result id", async () => {
    const [old] = outputs();
    const oldResult = results()[0]!;
    act(() => { openCommittedResultInTool(resultId()); });
    const before = useApp.getState().history.length;
    vi.mocked(normalizeMagMoment).mockImplementation(fakeBackend(3));
    const hook = renderHook(() => useMagNormalization());
    act(() => hook.result.current.setFieldText("filmThickness", "40"));
    await act(async () => { await hook.result.current.apply(); });
    expect(outputs()).toHaveLength(1);
    expect(outputs()[0]!.id).toBe(old!.id);
    expect(outputs()[0]!.data.values[2]![0]).toBeCloseTo(4.5e-3);
    expect(results()).toHaveLength(1);
    expect(results()[0]!.id).toBe(oldResult.id);
    expect(useApp.getState().history.length).toBe(before + 1);
    act(() => useApp.getState().undo());
    expect(outputs()[0]!.data).toEqual(old!.data);
    expect(results()).toEqual([oldResult]);
  });

  it("Add as a new output keeps the old output and adds a second result", async () => {
    act(() => { openCommittedResultInTool(resultId()); });
    act(() => useToolReopen.getState().setMode("mag-normalization", "new"));
    vi.mocked(normalizeMagMoment).mockImplementation(fakeBackend(3));
    const hook = renderHook(() => useMagNormalization());
    act(() => hook.result.current.setFieldText("filmThickness", "40"));
    await act(async () => { await hook.result.current.apply(); });
    expect(outputs()).toHaveLength(2);
    expect(results()).toHaveLength(2);
  });

  it("the panel opens on the Units tab with the banner", () => {
    act(() => { openCommittedResultInTool(resultId()); });
    render(<MagToolsPanel />);
    expect(screen.getByRole("region", { name: "Editing a committed result" })).toHaveTextContent("Opened from the result");
    expect(screen.getByLabelText("Target field unit")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------- Internal field

const loop = (): Dataset => ({
  id: "src", name: "loop.dat",
  data: {
    time: [-1000, 0, 1000], values: [[-10], [0], [10]], labels: ["Magnetization"], units: ["emu/cm³"],
    metadata: { x_column_name: "Magnetic field", x_column_unit: "Oe" },
  },
});
const demagResponse = (shift: number) => ({
  field: [-958 + shift, 0, 958 + shift], field_errors: [] as number[][], field_unit: "Oe", magnetization_unit: "emu/cm³",
  shape: "Sphere", n_factor: 1 / 3, n_cgs: 4 * Math.PI / 3,
});

async function applyDemag(shape: "Sphere" | "Thin film (in-plane)"): Promise<void> {
  const hook = renderHook(() => useDemagCorrection());
  act(() => hook.result.current.setShape(shape));
  await act(async () => { await hook.result.current.apply(); });
  hook.unmount();
}

describe("Internal field: reopen, adjust, replace", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(demagCorrectField).mockResolvedValue(demagResponse(0));
    load(loop());
    await applyDemag("Sphere");
    expect(outputs()).toHaveLength(1);
  });
  contract("mag-demag", "Internal field");

  it("reopens with the recorded geometry, Replace preselected", () => {
    act(() => { expect(openCommittedResultInTool(resultId())).toBe(true); });
    const { result } = renderHook(() => useDemagCorrection());
    expect(result.current.shape).toBe("Sphere");
    expect(session("mag-demag").mode).toBe("replace");
  });

  it("an unknown recorded geometry is not guessed and turns Replace off", () => {
    useApp.setState((s) => ({
      analysisResults: s.analysisResults.map((r) => ({ ...r, parameters: { ...r.parameters, settings: { ...(r.parameters!["settings"] as object), shape: "Torus" } } })),
    }));
    act(() => { openCommittedResultInTool(resultId()); });
    const { result } = renderHook(() => useDemagCorrection());
    expect(result.current.shape).toBe("");
    expect(result.current.seedProblem).toContain("Replace is off");
    expect(session("mag-demag").mode).toBe("new");
  });

  it("Replace rewrites the output in ONE undo step, keeping its id and the result id", async () => {
    const [old] = outputs();
    const oldResult = results()[0]!;
    act(() => { openCommittedResultInTool(resultId()); });
    const before = useApp.getState().history.length;
    vi.mocked(demagCorrectField).mockResolvedValue(demagResponse(5));
    const hook = renderHook(() => useDemagCorrection());
    await act(async () => { await hook.result.current.apply(); });
    expect(outputs()).toHaveLength(1);
    expect(outputs()[0]!.id).toBe(old!.id);
    expect(outputs()[0]!.data.time[0]).toBe(-953);
    expect(results()).toHaveLength(1);
    expect(results()[0]!.id).toBe(oldResult.id);
    expect(useApp.getState().history.length).toBe(before + 1);
    act(() => useApp.getState().undo());
    expect(outputs()[0]!.data).toEqual(old!.data);
    expect(results()).toEqual([oldResult]);
  });

  it("Add as a new output keeps the old output", async () => {
    act(() => { openCommittedResultInTool(resultId()); });
    act(() => useToolReopen.getState().setMode("mag-demag", "new"));
    vi.mocked(demagCorrectField).mockResolvedValue(demagResponse(5));
    const hook = renderHook(() => useDemagCorrection());
    await act(async () => { await hook.result.current.apply(); });
    expect(outputs()).toHaveLength(2);
    expect(results()).toHaveLength(2);
  });
});

// ---------------------------------------------------------------- Curie-Weiss

const mt = (): Dataset => ({
  id: "src", name: "sample.dat",
  data: {
    time: [100, 200, 300, 400], values: [[0.04, 1000], [0.02, 1000], [0.013333, 1000], [0.01, 1000]],
    labels: ["DC Moment", "Magnetic Field"], units: ["emu", "Oe"],
    metadata: { x_column_name: "Temperature", x_column_unit: "K", technique: "magnetometry.mvst" },
  },
});
const cwResult = (scale: number): CurieWeissDataFitResult => ({
  theta_cw: 50, C: 4, mu_eff: 5.6568, fit_line: [0.25, -12.5], r2: 0.999,
  inv_chi: [25, 50, 75, 100].map((v) => v * scale), susceptibility_molar: [0.04, 0.02, 0.013, 0.01],
  susceptibility_errors_molar: [], inverse_errors: [], fit_inv_chi: [12.5, 37.5, 62.5, 87.5].map((v) => v * scale),
  fit_mask: [true, true, true, true], n_fit: 4, fit_range_used: [200, 400], excluded_nonpositive: 0,
});

async function fitCw(molar: number): Promise<void> {
  const hook = renderHook(() => useCurieWeiss());
  act(() => { hook.result.current.setSampleMass(100); hook.result.current.setMolarMass(molar); hook.result.current.setFitMin(150); });
  await act(async () => { await hook.result.current.fit(); });
  hook.unmount();
}

describe("Curie-Weiss: reopen, adjust, replace", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(magneticCurieWeissDataFit).mockResolvedValue(cwResult(1));
    load(mt());
    await fitCw(200);
    expect(outputs()).toHaveLength(1);
  });
  contract("curie-weiss", "Curie–Weiss");

  it("reopens with the recorded basis, mass, molar mass and fit range (not the defaults)", () => {
    act(() => { expect(openCommittedResultInTool(resultId())).toBe(true); });
    const { result } = renderHook(() => useCurieWeiss());
    expect(result.current.basisChoice).toBe("auto");
    expect(result.current.sampleMass).toBeCloseTo(0.1);
    expect(result.current.massUnit).toBe("g");
    expect(result.current.molarMass).toBe(200);
    expect(result.current.fitMin).toBe(150);
    expect(result.current.fitMax).toBe(400);
    expect(result.current.selectedField?.index).toBe(1);
    expect(session("curie-weiss").mode).toBe("replace");
  });

  it("a recorded field column that is gone is not swapped for another and turns Replace off", () => {
    useApp.setState((s) => ({
      analysisResults: s.analysisResults.map((r) => ({ ...r, parameters: { ...r.parameters, settings: { ...(r.parameters!["settings"] as object), fieldKey: 7 } } })),
    }));
    act(() => { openCommittedResultInTool(resultId()); });
    const { result } = renderHook(() => useCurieWeiss());
    expect(result.current.seedProblem).toContain("applied-field column is no longer there");
    expect(session("curie-weiss").mode).toBe("new");
  });

  it("Replace rewrites the output in ONE undo step, keeping its id and the result id", async () => {
    const [old] = outputs();
    const oldResult = results()[0]!;
    act(() => { openCommittedResultInTool(resultId()); });
    const before = useApp.getState().history.length;
    vi.mocked(magneticCurieWeissDataFit).mockResolvedValue(cwResult(2));
    const hook = renderHook(() => useCurieWeiss());
    act(() => hook.result.current.setMolarMass(300));
    await act(async () => { await hook.result.current.fit(); });
    expect(outputs()).toHaveLength(1);
    expect(outputs()[0]!.id).toBe(old!.id);
    expect(outputs()[0]!.data.values[0]![0]).toBe(50);
    expect(outputs()[0]!.derivedFrom).toEqual({ datasetId: "src", pipeline: "curie-weiss" }); // the link the tool made survives
    expect(results()).toHaveLength(1);
    expect(results()[0]!.id).toBe(oldResult.id);
    expect(useApp.getState().history.length).toBe(before + 1);
    act(() => useApp.getState().undo());
    expect(outputs()[0]!.data).toEqual(old!.data);
    expect(results()).toEqual([oldResult]);
  });

  it("Add as a new output keeps the old output", async () => {
    act(() => { openCommittedResultInTool(resultId()); });
    act(() => useToolReopen.getState().setMode("curie-weiss", "new"));
    vi.mocked(magneticCurieWeissDataFit).mockResolvedValue(cwResult(2));
    const hook = renderHook(() => useCurieWeiss());
    act(() => hook.result.current.setMolarMass(300));
    await act(async () => { await hook.result.current.fit(); });
    expect(outputs()).toHaveLength(2);
    expect(results()).toHaveLength(2);
  });
});
