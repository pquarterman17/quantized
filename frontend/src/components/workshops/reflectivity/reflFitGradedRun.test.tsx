// Fitting a graded (spline) layer end to end through the hooks (S2): the
// request carries the knots as parameters plus the `graded` spec, the stored
// record keeps both, "Apply to model" writes the fitted knots back, and a
// DREAM run of that record re-sends the spec.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { pollReflJob, reflDream, reflFit, reflPresets } from "../../../lib/api/reflectivity";
import { useApp } from "../../../store/useApp";
import { dreamResult, fitResponse, TEST_PRESETS, xrrDataset } from "./reflFit.testkit";
import { recordsFor } from "./reflFitRecord";
import { useReflFit } from "./useReflFit";
import { useReflectivity } from "./useReflectivity";

vi.mock("uplot", async () => ({ default: (await import("./reflFit.testkit")).UPlotStub }));
vi.mock("../../../lib/api/reflectivity", () => ({
  reflPresets: vi.fn(),
  reflSimulate: vi.fn(),
  reflSldProfile: vi.fn(),
  reflFit: vi.fn(),
  reflDream: vi.fn(),
  pollReflJob: vi.fn(),
  cancelReflJob: vi.fn(),
}));

function useBoth() {
  const refl = useReflectivity();
  const fit = useReflFit(refl);
  return { refl, fit };
}

const realResolve = useApp.getState().resolveDataset;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(reflPresets).mockResolvedValue({ presets: TEST_PRESETS });
  useApp.setState({
    datasets: [xrrDataset()],
    activeId: "xrr",
    status: "",
    fitOverlay: null,
    reflectivitySeed: null,
    resolveDataset: realResolve,
  });
});

async function gradedHook() {
  const view = renderHook(() => useBoth());
  await waitFor(() => expect(view.result.current.refl.presets).toHaveLength(TEST_PRESETS.length));
  act(() => view.result.current.refl.updateLayer(1, { preset: "", sld: 3e-5, isld: 0, graded: { knots: [2e-5, 5e-5, 3e-5], method: "pchip" } }));
  return view;
}

const FITTED = [
  { name: "L1.thickness", value: 196, stderr: 0.5, vary: true, tie: null, at_bound: false },
  { name: "L1.knot0.sld", value: 2e-5, stderr: null, vary: false, tie: null, at_bound: false },
  { name: "L1.knot1.sld", value: 4.6e-5, stderr: 2e-7, vary: true, tie: null, at_bound: false },
  { name: "L1.knot2.sld", value: 3e-5, stderr: null, vary: false, tie: null, at_bound: false },
];

describe("fitting a graded layer", () => {
  it("sends the knots as parameters with the graded spec, and stores both", async () => {
    vi.mocked(reflFit).mockResolvedValue(fitResponse({ parameters: FITTED, free: ["L1.thickness", "L1.knot1.sld"] }));
    const { result } = await gradedHook();
    act(() => result.current.fit.setParam("L1.knot1.sld", { vary: true, min: 1e-5, max: 8e-5 }));
    await act(async () => {
      await result.current.fit.run();
    });

    const body = vi.mocked(reflFit).mock.calls[0][0];
    expect(body.graded).toEqual([{ layer: 1, method: "pchip", slices: 100 }]);
    const names = body.parameters.map((p) => p.name);
    expect(names.filter((n) => n.startsWith("L1."))).toEqual([
      "L1.thickness", "L1.knot0.sld", "L1.knot1.sld", "L1.knot2.sld", "L1.roughness",
    ]);
    expect(body.parameters.find((p) => p.name === "L1.knot1.sld")).toEqual({
      name: "L1.knot1.sld", value: 5e-5, vary: true, min: 1e-5, max: 8e-5, tie: null,
    });

    const [saved] = recordsFor(useApp.getState().datasets[0]);
    expect(saved.request.graded).toEqual([{ layer: 1, method: "pchip", slices: 100 }]);
    expect(saved.model.layers[1].graded).toEqual({ knots: [2e-5, 5e-5, 3e-5], method: "pchip" });
    expect(saved.result.parameters.find((p) => p.name === "L1.knot1.sld")?.value).toBe(4.6e-5);

    act(() => result.current.fit.applyToModel());
    expect(result.current.refl.layers[1]).toMatchObject({ thickness: 196, graded: { knots: [2e-5, 4.6e-5, 3e-5] } });
  });

  it("re-sends the graded spec when sampling the fit's posterior", async () => {
    vi.mocked(reflFit).mockResolvedValue(fitResponse({ parameters: FITTED, free: ["L1.thickness", "L1.knot1.sld"] }));
    vi.mocked(reflDream).mockResolvedValue({ job_id: "j1", plan: { n_free: 2, n_chains: 10, n_generations: 20, n_evaluations: 300, band_draws: 10 } });
    vi.mocked(pollReflJob).mockResolvedValue(dreamResult() as never);
    const { result } = await gradedHook();
    await act(async () => {
      await result.current.fit.run();
    });
    const record = result.current.fit.liveRecord!;
    await act(async () => {
      await result.current.fit.dream.run(record);
    });
    const body = vi.mocked(reflDream).mock.calls[0][0];
    expect(body.graded).toEqual([{ layer: 1, method: "pchip", slices: 100 }]);
    expect(body.centre).toMatchObject({ "L1.knot1.sld": 4.6e-5 });
  });

  it("leaves a slab-only request exactly as before", async () => {
    vi.mocked(reflFit).mockResolvedValue(fitResponse());
    const view = renderHook(() => useBoth());
    await waitFor(() => expect(view.result.current.refl.presets).toHaveLength(TEST_PRESETS.length));
    await act(async () => {
      await view.result.current.fit.run();
    });
    expect(vi.mocked(reflFit).mock.calls[0][0]).not.toHaveProperty("graded");
    expect(recordsFor(useApp.getState().datasets[0])[0].request).not.toHaveProperty("graded");
  });
});
