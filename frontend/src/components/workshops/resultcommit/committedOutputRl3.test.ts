// Lane RL3: Pawley, reflectivity FFT, MagTools background and hysteresis
// background commit through the shared result contract. Fail-before: each wrote
// its output with a raw addDataset, so a repeat click made a second identical
// worksheet, the output was not one undo step with a Library result, and nothing
// marked it Out of date when its source worksheet changed.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PawleyResult } from "../../../lib/reductionTypes";
import type { DataStruct } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { useApp } from "../../../store/useApp";
import { useHysteresis } from "../hysteresis/useHysteresis";
import { useMagTools } from "../magtools/useMagTools";
import { usePawley } from "../reductions/usePawley";
import { useReflectivityFft } from "../reductions/useReflectivityFft";

vi.mock("../../../lib/api/reductions", () => ({ pawleyRefine: vi.fn(), reflectivityFft: vi.fn() }));
vi.mock("../../../lib/api/magnetometry", () => ({
  subtractMagBackground: vi.fn(), subtractHysteresisBackground: vi.fn(), hysteresisAnalysis: vi.fn(),
  normalizeMagMoment: vi.fn(), demagCorrectField: vi.fn(),
}));
const { pawleyRefine, reflectivityFft } = await import("../../../lib/api/reductions");
const { subtractMagBackground, subtractHysteresisBackground, hysteresisAnalysis } = await import("../../../lib/api/magnetometry");

const XRD: DataStruct = {
  time: [20, 30, 40, 50], values: [[100], [200], [300], [400]], labels: ["Intensity"], units: ["cps"],
  metadata: { x_column_name: "2-Theta", x_column_unit: "deg" },
};
const PAWLEY: PawleyResult = {
  cell: [5.42, 5.42, 5.42, 90, 90, 90], cell_initial: [5.43, 5.43, 5.43, 90, 90, 90], scale: null,
  peaks: [{ hkl: [1, 1, 1], two_theta: 28.4, d: 3.13, multiplicity: 8, intensity: 12 }],
  background: [10, 11, 12, 13], model: [90, 190, 290, 390], residual: [10, 10, 10, 10],
  rwp: 0.05, rwp_initial: 0.2, rwp_background: 0.5, converged: true, tie: "abc", hkl_max: 8, n_peaks: 1,
};
const XRR: DataStruct = {
  time: [0.01, 0.05, 0.09, 0.12], values: [[1], [0.5], [0.2], [0.1]], labels: ["R"], units: [""], metadata: {},
};
const MVT: DataStruct = {
  time: [2, 100, 300], values: [[5], [2], [1]], labels: ["Moment"], units: ["emu"],
  metadata: { x_column_name: "Temperature", x_column_unit: "K" },
};
const MVH: DataStruct = {
  time: [-2, -1, 0, 1, 2], values: [[-1], [-0.5], [0], [0.5], [1]], labels: ["M"], units: ["emu"],
  metadata: { x_column_name: "Magnetic Field", x_column_unit: "Oe" },
};

const outputs = () => useApp.getState().datasets.filter((d) => d.id !== "d1");
const results = () => useApp.getState().analysisResults;
const changeSource = (): void => {
  act(() => {
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => d.id === "d1" ? { ...d, data: { ...d.data, time: d.data.time.map((t) => t + 0.5) } } : d) }));
    useApp.getState().touchDataset("d1");
  });
};

function load(data: DataStruct, name: string): void {
  useAnalysisSelection.getState().clear();
  useApp.setState({
    datasets: [{ id: "d1", name, data }], activeId: "d1", selectedIds: [], folders: [], xKey: null, yKeys: null, seriesOrder: null,
    status: "", analysisResults: [], staleDatasets: [], staleFits: [], history: [], future: [], refLines: [], recalcMode: "manual",
    resolveDataset: async (id: string) => useApp.getState().datasets.find((d) => d.id === id),
  });
}

beforeEach(() => vi.clearAllMocks());

describe("Pawley → Library", () => {
  beforeEach(() => {
    load(XRD, "powder.xrdml");
    vi.mocked(pawleyRefine).mockResolvedValue(PAWLEY);
  });
  async function refine() {
    const hook = renderHook(() => usePawley());
    await act(async () => { await hook.result.current.compute(); });
    return hook.result;
  }

  it("a repeat → Library adds nothing, says why, and is disabled", async () => {
    const r = await refine();
    act(() => r.current.toLibrary());
    expect(outputs()).toHaveLength(1);
    // Adding activates the output; back on the source, the same computation is made again.
    act(() => useApp.getState().setActive("d1"));
    await act(async () => { await r.current.compute(); });
    expect(r.current.addDisabledReason).toMatch(/Already added as “powder.xrdml \(Pawley\)”/);
    act(() => r.current.toLibrary());
    expect(outputs()).toHaveLength(1);
    expect(results()).toHaveLength(1);
    expect(results()[0].producer.label).toBe("Pawley refinement");
  });

  it("is one undo step with its Library result, and goes Out of date when the source changes", async () => {
    const r = await refine();
    act(() => r.current.toLibrary());
    expect(useApp.getState().history).toHaveLength(1);
    const id = outputs()[0].id;
    changeSource();
    expect(useApp.getState().staleDatasets).toEqual([id]);
    act(() => { useApp.setState({ staleDatasets: [] }); useApp.getState().undo(); });
    expect(outputs()).toHaveLength(0);
    expect(results()).toHaveLength(0);
  });

  it("a refinement under different settings is a different output", async () => {
    const r = await refine();
    act(() => r.current.toLibrary());
    act(() => r.current.setRefineCell(false));
    await act(async () => { await r.current.compute(); });
    act(() => r.current.toLibrary());
    expect(outputs()).toHaveLength(2);
  });

  it("a refinement that started from a different cell is a different output", async () => {
    const r = await refine();
    act(() => r.current.toLibrary());
    act(() => useApp.getState().setActive("d1"));
    vi.mocked(pawleyRefine).mockResolvedValue({ ...PAWLEY, cell_initial: [5.5, 5.5, 5.5, 90, 90, 90] });
    await act(async () => { await r.current.compute(); });
    act(() => r.current.toLibrary());
    expect(outputs()).toHaveLength(2);
  });

  it("refuses a result that went out of date (nothing is added)", async () => {
    const r = await refine();
    changeSource();
    expect(r.current.addDisabledReason).toMatch(/Out of date/);
    act(() => r.current.toLibrary());
    expect(outputs()).toHaveLength(0);
  });
});

describe("Reflectivity FFT → Library", () => {
  const FFT = {
    thicknesses_nm: [50], amplitudes: [10], harmonic_labels: ["Independent"], q_range: [0.01, 0.12] as [number, number],
    preprocess: "logR", fft_magnitude: [1, 2], thickness_axis: [0, 10], is_neutron: false, wavelength_a: 1.5406,
    superlattice: { detected: false, bilayer_period_nm: null, total_thickness_nm: null, n_repeats: null, sublayer_a_nm: null, sublayer_b_nm: null, suppressed_orders: [] },
  };
  beforeEach(() => {
    load(XRR, "xrr.dat");
    vi.mocked(reflectivityFft).mockResolvedValue(FFT as never);
  });
  async function run() {
    const hook = renderHook(() => useReflectivityFft());
    await act(async () => { await hook.result.current.compute(); });
    return hook.result;
  }

  it("a repeat → Library adds nothing, says why, and is disabled", async () => {
    const r = await run();
    act(() => r.current.toLibrary());
    expect(outputs()).toHaveLength(1);
    expect(outputs()[0].name).toBe("xrr.dat (refl FFT)");
    // Adding activates the output; back on the source, the same computation is made again.
    act(() => useApp.getState().setActive("d1"));
    await act(async () => { await r.current.compute(); });
    expect(r.current.addDisabledReason).toMatch(/Already added as “xrr.dat \(refl FFT\)”/);
    act(() => r.current.toLibrary());
    expect(outputs()).toHaveLength(1);
    expect(results()).toHaveLength(1);
  });

  it("is one undo step with its Library result, and goes Out of date when the source changes", async () => {
    const r = await run();
    act(() => r.current.toLibrary());
    expect(useApp.getState().history).toHaveLength(1);
    const id = outputs()[0].id;
    changeSource();
    expect(useApp.getState().staleDatasets).toEqual([id]);
    act(() => { useApp.setState({ staleDatasets: [] }); useApp.getState().undo(); });
    expect(outputs()).toHaveLength(0);
    expect(results()).toHaveLength(0);
  });

  it("a different window function is a different output", async () => {
    const r = await run();
    act(() => r.current.toLibrary());
    act(() => r.current.setWindowFn("blackman"));
    await act(async () => { await r.current.compute(); });
    act(() => r.current.toLibrary());
    expect(outputs()).toHaveLength(2);
  });
});

describe("MagTools background", () => {
  async function run(data: DataStruct, name: string, mockFn: () => void) {
    load(data, name);
    mockFn();
    const hook = renderHook(() => useMagTools());
    await act(async () => { await hook.result.current.subtractBackground(); });
    return hook.result;
  }
  const mt = () => vi.mocked(subtractMagBackground).mockResolvedValue({ corrected: [4, 1, 0], slope: -0.01, intercept: 3 });

  it("a repeat run adds nothing and says so (M(T) and M(H) paths)", async () => {
    const r = await run(MVT, "mt.dat", mt);
    // Adding activates the output; back on the source, the same computation is made again.
    act(() => useApp.getState().setActive("d1"));
    await act(async () => { await r.current.subtractBackground(); });
    expect(outputs()).toHaveLength(1);
    expect(results()).toHaveLength(1);
    expect(useApp.getState().status).toMatch(/already added as “mt \(bg-sub\)”; nothing was duplicated/);

    const h = await run(MVH, "mh.dat", () => vi.mocked(subtractHysteresisBackground).mockResolvedValue({ corrected: [-1, -0.5, 0, 0.5, 1], slope: 0.1, offset: 0.2 }));
    // Adding activates the output; back on the source, the same computation is made again.
    act(() => useApp.getState().setActive("d1"));
    await act(async () => { await h.current.subtractBackground(); });
    expect(outputs()).toHaveLength(1);
    expect(outputs()[0].name).toBe("mh (loop bg-sub)");
    expect(results()).toHaveLength(1);
  });

  it("is one undo step with its Library result, and goes Out of date when the source changes", async () => {
    await run(MVT, "mt.dat", mt);
    expect(useApp.getState().history).toHaveLength(1);
    const id = outputs()[0].id;
    changeSource();
    expect(useApp.getState().staleDatasets).toEqual([id]);
    act(() => { useApp.setState({ staleDatasets: [] }); useApp.getState().undo(); });
    expect(outputs()).toHaveLength(0);
    expect(results()).toHaveLength(0);
  });

  it("a different fit fraction is a different output", async () => {
    const r = await run(MVT, "mt.dat", mt);
    act(() => r.current.setAutoFraction(0.3));
    vi.mocked(subtractMagBackground).mockResolvedValue({ corrected: [4, 1.5, 0.5], slope: -0.02, intercept: 3 });
    await act(async () => { await r.current.subtractBackground(); });
    expect(outputs()).toHaveLength(2);
  });
});

describe("Hysteresis background", () => {
  beforeEach(() => {
    load(MVH, "mvsh.dat");
    vi.mocked(hysteresisAnalysis).mockResolvedValue({ Hc: 0.1, Mr: 0.2, Ms: 1.0 } as never);
    vi.mocked(subtractHysteresisBackground).mockResolvedValue({ corrected: [-1, -0.5, 0, 0.5, 1], slope: 0.1, offset: 0.2 });
  });
  async function run() {
    const hook = renderHook(() => useHysteresis());
    await act(async () => { await hook.result.current.subtractBackground(); });
    return hook.result;
  }

  it("a repeat run adds nothing and says so", async () => {
    const r = await run();
    // Adding activates the output; back on the source, the same computation is made again.
    act(() => useApp.getState().setActive("d1"));
    await act(async () => { await r.current.subtractBackground(); });
    expect(outputs()).toHaveLength(1);
    expect(outputs()[0].name).toBe("mvsh (bg-sub)");
    expect(results()).toHaveLength(1);
    expect(useApp.getState().status).toMatch(/already added as “mvsh \(bg-sub\)”; nothing was duplicated/);
  });

  it("is one undo step with its Library result, and goes Out of date when the source changes", async () => {
    await run();
    expect(useApp.getState().history).toHaveLength(1);
    const id = outputs()[0].id;
    changeSource();
    expect(useApp.getState().staleDatasets).toEqual([id]);
    act(() => { useApp.setState({ staleDatasets: [] }); useApp.getState().undo(); });
    expect(outputs()).toHaveLength(0);
    expect(results()).toHaveLength(0);
  });
});
