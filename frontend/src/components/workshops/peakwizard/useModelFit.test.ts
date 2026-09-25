// The Peak Analyzer's mixed-shape model engine through usePeakWizard (audit
// P2.4 slice 2): the request body the backend receives (a real `postJSON`
// over a stubbed fetch), stale / superseded responses, the ASCII error
// detail, and the plot overlays. Waits are on hook STATE, never on a mock.

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PeakModelFitResponse } from "../../../lib/api/peaks";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { modelFitResponse } from "./modelFit.testkit";
import { usePeakWizard } from "./usePeakWizard";

const N = 60;
const DATA: DataStruct = {
  time: Array.from({ length: N }, (_, i) => i / 10),
  values: Array.from({ length: N }, (_, i) => [1 + Math.exp(-((i - 20) ** 2) / 8) + 0.5 * Math.exp(-((i - 40) ** 2) / 8)]),
  labels: ["I"],
  units: ["cts"],
  metadata: {},
};

interface Call { url: string; body: Record<string, unknown> }
let calls: Call[] = [];
let pending: { resolve: (r: Response) => void }[] = [];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** fetch stub: records each call; answers from `answer`, or holds the call
 *  open (`pending`) when `answer` is undefined. */
function stubFetch(answer?: (i: number) => Response) {
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(init.body as string) as Record<string, unknown> });
    if (answer) return Promise.resolve(answer(calls.length - 1));
    return new Promise<Response>((resolve) => pending.push({ resolve }));
  });
}

beforeEach(() => {
  calls = [];
  pending = [];
  localStorage.clear();
  useApp.setState({
    datasets: [{ id: "d1", name: "scan", data: DATA }],
    activeId: "d1",
    xKey: null,
    yKeys: null,
    seriesOrder: null,
    peakOverlay: null,
    baselineOverlay: null,
    fitOverlay: null,
    peakWizardEdit: null,
  });
});
afterEach(() => vi.unstubAllGlobals());

function wizardWithTwoPeaks() {
  const hook = renderHook(() => usePeakWizard());
  act(() => hook.result.current.addPeakAt(2));
  act(() => hook.result.current.addPeakAt(4));
  return hook;
}

describe("useModelFit — request", () => {
  it("is the default engine and posts shapes, background, every parameter and the range", async () => {
    stubFetch(() => json(200, modelFitResponse()));
    const { result } = wizardWithTwoPeaks();
    expect(result.current.model.engine).toBe("model");
    act(() => result.current.patchRecipe({ range: { lo: 0.5 } }));
    act(() => result.current.model.setShape(1, "voigt"));
    act(() => result.current.model.patch("p0.height", { vary: false }));
    await act(() => result.current.model.run());
    await waitFor(() => expect(result.current.model.result).not.toBeNull());

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/peaks/model-fit");
    const body = calls[0].body;
    const x = body.x as number[];
    expect(x[0]).toBe(0.5); // range-cut working segment
    expect((body.y as number[]).length).toBe(x.length);
    expect(body.shapes).toEqual(["gaussian", "voigt"]);
    expect(body.background).toBe("linear"); // recipe bgDegree 1
    expect(body.x_min).toBe(0.5);
    expect(body).not.toHaveProperty("x_max");
    expect(body.bg_x_ref).toBeCloseTo((0.5 + 5.9) / 2);
    const params = body.parameters as { name: string; vary: boolean }[];
    expect(params.map((p) => p.name)).toEqual([
      "p0.center", "p0.height", "p0.fwhm",
      "p1.center", "p1.height", "p1.fwhm_g", "p1.fwhm_l",
      "bg.c0", "bg.c1",
    ]);
    expect(params.every((p) => typeof p.vary === "boolean")).toBe(true);
    expect(params.find((p) => p.name === "p0.height")).toMatchObject({ vary: false, min: 0, max: null, tie: null });
  });

  it("table edits survive re-renders; a real change (a peak excluded) re-seeds", () => {
    const { result } = wizardWithTwoPeaks();
    act(() => result.current.model.patch("p0.fwhm", { max: 3 }));
    act(() => result.current.patchRecipe({ report: { regionWidth: 4 } })); // unrelated re-render
    expect(result.current.model.setup.params.find((p) => p.name === "p0.fwhm")?.max).toBe(3);
    act(() => result.current.togglePeak(1));
    expect(result.current.model.setup.shapes).toHaveLength(1);
    expect(result.current.model.setup.params.find((p) => p.name === "p0.fwhm")?.max).not.toBe(3);
  });
});

describe("useModelFit — stale and superseded responses never overwrite a newer run", () => {
  it("a cancelled run's late answer is dropped; the newer run's result stands", async () => {
    stubFetch();
    const { result } = wizardWithTwoPeaks();
    let first!: Promise<void>;
    act(() => { first = result.current.model.run(); });
    expect(result.current.model.busy).toBe(true);
    act(() => result.current.model.cancel());
    expect(result.current.model.busy).toBe(false);
    expect(result.current.model.notice).toMatch(/cancelled/);
    let second!: Promise<void>;
    act(() => { second = result.current.model.run(); });
    await act(async () => {
      pending[1].resolve(json(200, modelFitResponse({ message: "second" })));
      await second;
    });
    expect(result.current.model.result?.message).toBe("second");
    await act(async () => {
      pending[0].resolve(json(200, modelFitResponse({ message: "first (stale)" })));
      await first;
    });
    expect(result.current.model.result?.message).toBe("second");
    expect(result.current.model.busy).toBe(false);
  });

  it("a configuration change mid-flight drops the in-flight answer", async () => {
    stubFetch();
    const { result } = wizardWithTwoPeaks();
    let run!: Promise<void>;
    act(() => { run = result.current.model.run(); });
    act(() => result.current.patchRecipe({ model: { shape: "Lorentzian" } }));
    await act(async () => {
      pending[0].resolve(json(200, modelFitResponse()));
      await run;
    });
    expect(result.current.model.result).toBeNull();
    expect(result.current.model.busy).toBe(false);
    expect(useApp.getState().fitOverlay).toBeNull();
  });
});

describe("useModelFit — errors", () => {
  it("shows the backend's ASCII detail verbatim", async () => {
    const detail = "p1.fwhm is tied to p0.fwhm, which is fixed (vary=false); tie only to a varying parameter, or fix both";
    stubFetch(() => json(422, { detail }));
    const { result } = wizardWithTwoPeaks();
    await act(() => result.current.model.run());
    expect(result.current.model.error).toBe(detail);
    expect(result.current.model.result).toBeNull();
    expect(result.current.model.busy).toBe(false);
  });

  it("refuses to run with no included peak, without a request", async () => {
    stubFetch(() => json(200, modelFitResponse()));
    const { result } = renderHook(() => usePeakWizard());
    await act(() => result.current.model.run());
    expect(result.current.model.error).toBe("include at least one peak first");
    expect(calls).toHaveLength(0);
  });
});

describe("useModelFit — overlays, stale flag, start from fit", () => {
  it("draws model + background on the plot rows the fit saw, and takes them back", async () => {
    const res: PeakModelFitResponse = modelFitResponse();
    res.curves.x = [0, 0.1, 0.2];
    res.curves.model = [1.5, 1.6, 1.7];
    res.curves.background = [0.9, 0.9, 0.9];
    stubFetch(() => json(200, res));
    const { result } = wizardWithTwoPeaks();
    await act(() => result.current.model.run());
    const fit = useApp.getState().fitOverlay;
    expect(fit?.datasetId).toBe("d1");
    expect(fit?.y.slice(0, 4)).toEqual([1.5, 1.6, 1.7, null]);
    expect(useApp.getState().baselineOverlay?.y.slice(0, 3)).toEqual([0.9, 0.9, 0.9]);

    expect(result.current.model.stale).toBe(false);
    act(() => result.current.model.patch("p0.center", { min: 1 }));
    expect(result.current.model.stale).toBe(true);
    act(() => result.current.model.startFromResult());
    expect(result.current.model.setup.params.find((p) => p.name === "p0.center")?.value).toBe(2.01);

    act(() => result.current.patchRecipe({ find: { max_peaks: 5 } }));
    expect(useApp.getState().fitOverlay).toBeNull();
    expect(useApp.getState().baselineOverlay).toBeNull(); // baseline "none": no preview to restore
  });

  it("a report-only setting keeps the fit; a model input drops it", async () => {
    stubFetch(() => json(200, modelFitResponse()));
    const { result } = wizardWithTwoPeaks();
    await act(() => result.current.model.run());
    act(() => result.current.patchRecipe({ report: { mode: "integrate" } }));
    expect(result.current.model.result).not.toBeNull();
    expect(result.current.canReportFit).toBe(true);
    act(() => result.current.patchRecipe({ baseline: { method: "none" } }));
    expect(result.current.model.result).toBeNull();
    expect(result.current.canReportFit).toBe(false);
  });

  it("switching the active dataset drops the result", async () => {
    stubFetch(() => json(200, modelFitResponse()));
    useApp.setState({ datasets: [...useApp.getState().datasets, { id: "d2", name: "other", data: DATA }] });
    const { result } = wizardWithTwoPeaks();
    await act(() => result.current.model.run());
    expect(result.current.model.result).not.toBeNull();
    act(() => useApp.setState({ activeId: "d2" }));
    expect(result.current.model.result).toBeNull();
  });
});
