// Film-stack hand-off review fixes: stale fit overrides, the second-send race,
// and the fit's own re-check of a blocked (blank-SLD) model.
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { reflFit, reflPresets } from "../../../lib/api/reflectivity";
import { askConfirm } from "../../../store/confirmDialog";
import type { StackSeed } from "../../../store/workshopFlags";
import type { Dataset, SldPreset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useReflFit } from "./useReflFit";
import { useReflectivity } from "./useReflectivity";

vi.mock("../../../store/confirmDialog", () => ({ askConfirm: vi.fn() }));
vi.mock("../../../lib/api/reflectivity", () => ({
  reflPresets: vi.fn(),
  reflSimulate: vi.fn(),
  reflSldProfile: vi.fn(),
  reflFit: vi.fn(),
}));

const PRESETS: SldPreset[] = [
  { name: "Air / Vacuum", formula: "", sldX: 0, sldN: 0, sldImag: 0, density: 0 },
  { name: "Nickel", formula: "Ni", sldX: 7.18e-5, sldN: 9.4e-6, sldImag: 5e-7, density: 8.9 },
  { name: "Silicon", formula: "Si", sldX: 2.007e-5, sldN: 2.073e-6, sldImag: 0, density: 2.33 },
];
const Q = [0.01, 0.02, 0.03];
const XRR = {
  id: "xrr",
  name: "film.refl",
  data: { time: Q, values: Q.map(() => [0.5, 0.01, 1e-4]), labels: ["I", "u", "r"], units: ["", "", "1/Ang"], metadata: { x_column_unit: "1/Ang" } },
  errorRoles: [{ channel: 1, target: 0, axis: "y", side: "both" }, { channel: 2, target: -1, axis: "x", side: "both" }],
} as Dataset;

// A same-length (3-row) seed: Air / film / substrate, the film SLD known, the substrate blank.
const SEED: StackSeed = {
  label: "film stack",
  stack: [
    { name: "film", thicknessA: 200, sld: { xray: 4e-5, neutron: 2e-6, xrayAbs: 0 } },
    { name: "substrate", thicknessA: null, sld: { xray: null, neutron: null, xrayAbs: null } },
  ],
};

function useBoth() {
  const refl = useReflectivity();
  return { refl, fit: useReflFit(refl) };
}
async function mount() {
  const view = renderHook(() => useBoth());
  await waitFor(() => expect(view.result.current.refl.presets).toHaveLength(PRESETS.length));
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(reflPresets).mockResolvedValue({ presets: PRESETS });
  useApp.setState({ datasets: [XRR], activeId: "xrr", status: "", reflectivitySeed: null });
});

describe("film-stack hand-off", () => {
  it("resets fit overrides: a same-length seed does not inherit a stale vary:false", async () => {
    const { result } = await mount();
    act(() => result.current.fit.setParam("L1.roughness", { vary: false }));
    expect(result.current.fit.params.find((p) => p.name === "L1.roughness")?.vary).toBe(false);
    vi.mocked(askConfirm).mockResolvedValue(true);
    act(() => useApp.getState().seedReflectivityLayer(SEED));
    // an override makes the model "touched": the user is asked, and on yes it is replaced
    await waitFor(() => expect(result.current.refl.layers[1].thickness).toBe(200));
    await waitFor(() => expect(result.current.fit.params.find((p) => p.name === "L1.roughness")?.vary).toBe(true));
    expect(askConfirm).toHaveBeenCalledTimes(1);
  });

  it("an override-free untouched model is seeded without a question", async () => {
    const { result } = await mount();
    act(() => useApp.getState().seedReflectivityLayer(SEED));
    await waitFor(() => expect(result.current.refl.layers[1].thickness).toBe(200));
    expect(askConfirm).not.toHaveBeenCalled();
  });

  it("a second send while the confirm is open wins; the stale first one stays silent", async () => {
    const { result } = await mount();
    act(() => result.current.refl.updateLayer(1, { thickness: 321 }));
    let answerFirst: ((ok: boolean) => void) | null = null;
    vi.mocked(askConfirm)
      .mockImplementationOnce(() => new Promise<boolean>((r) => { answerFirst = r; }))
      .mockResolvedValueOnce(true);
    act(() => useApp.getState().seedReflectivityLayer({ ...SEED, stack: [{ ...SEED.stack[0], thicknessA: 111 }, SEED.stack[1]] }));
    await waitFor(() => expect(answerFirst).not.toBeNull());
    act(() => useApp.getState().seedReflectivityLayer(SEED));
    await waitFor(() => expect(result.current.refl.layers[1].thickness).toBe(200));
    const status = useApp.getState().status;
    await act(async () => {
      answerFirst?.(false); // the replaced question settles "no"
      await Promise.resolve();
    });
    expect(useApp.getState().status).toBe(status); // not "cancelled"
    expect(useApp.getState().status).not.toContain("cancelled");
    expect(result.current.refl.layers[1].thickness).toBe(200);
  });

  it("does nothing after unmount", async () => {
    const { result, unmount } = await mount();
    act(() => result.current.refl.updateLayer(1, { thickness: 321 }));
    let answer: ((ok: boolean) => void) | null = null;
    vi.mocked(askConfirm).mockImplementationOnce(() => new Promise<boolean>((r) => { answer = r; }));
    act(() => useApp.getState().seedReflectivityLayer(SEED));
    await waitFor(() => expect(answer).not.toBeNull());
    unmount();
    useApp.setState({ status: "" });
    await act(async () => {
      answer?.(true);
      await Promise.resolve();
    });
    expect(useApp.getState().status).toBe("");
  });

  it("the fit itself refuses to run or apply while an SLD is blank", async () => {
    const { result } = await mount();
    act(() => useApp.getState().seedReflectivityLayer(SEED));
    await waitFor(() => expect(result.current.refl.layers[2].sldPending).toBe(true));
    await act(async () => {
      await result.current.fit.run();
    });
    expect(reflFit).not.toHaveBeenCalled();
    expect(result.current.fit.error).toMatch(/SLD not set for layer 2/);
  });

  it("applyToModel re-checks the block even with a result in hand", async () => {
    vi.mocked(reflFit).mockResolvedValue({
      parameters: [{ name: "L1.thickness", value: 150, stderr: null, vary: true, tie: null, at_bound: false }],
      free: ["L1.thickness"], correlation: [], chi2: 1, reduced_chi2: 1, sum_sq_log: null, reduced_sum_sq_log: null,
      n_points: 3, n_free: 1, success: true, message: "ok", n_evaluations: 3, weighting: "dr",
      curves: [{ label: "c", spin: null, q: Q, r: [1, 0.5, 0.2], dr: [0.01, 0.01, 0.01], model: [0.9, 0.4, 0.1], residual: [] }],
      sld_profiles: [{ spin: null, z: [-10, 0, 10], sld: [0, 7e-5, 2e-5] }], warnings: [],
    } as never);
    const { result } = await mount();
    await act(async () => {
      await result.current.fit.run();
    });
    expect(result.current.fit.result).not.toBeNull();
    // the stack is edited to a blank-SLD row without changing its signature
    act(() => result.current.refl.updateLayer(1, { sldPending: true }));
    act(() => result.current.fit.applyToModel());
    expect(result.current.fit.error).toMatch(/cannot apply: SLD not set for layer 1/);
    expect(result.current.refl.layers[1].thickness).toBe(200);
  });
});
