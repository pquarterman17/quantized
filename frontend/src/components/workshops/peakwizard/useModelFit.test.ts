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

describe("useModelFit — publish provenance (P2.1)", () => {
  const route = (failBaseline: boolean) => (i: number) => {
    const url = calls[i].url;
    if (url.includes("model-fit")) return json(200, modelFitResponse());
    if (failBaseline) return json(500, { detail: "baseline failed" });
    return json(200, { baseline: DATA.values.map(() => 0.25) });
  };

  it.each([
    [false, "constant background after als baseline", 0.75],
    [true, "constant background", 0.5], // a FAILED baseline was never subtracted
  ])("records the baseline actually subtracted (baseline fails: %s)", async (failBaseline, label, bg) => {
    stubFetch(route(failBaseline));
    const { result } = wizardWithTwoPeaks();
    act(() => result.current.patchRecipe({ baseline: { method: "als" } }));
    // Wait for the step-① baseline to settle: an error when it fails, else done.
    await waitFor(() => {
      expect(result.current.baselineBusy).toBe(false);
      if (failBaseline) expect(result.current.baselineError).not.toBeNull();
      else expect(calls.some((c) => !c.url.includes("model-fit"))).toBe(true);
    });
    await act(() => result.current.model.run());
    await waitFor(() => expect(result.current.model.result).not.toBeNull());
    await act(() => result.current.model.publishToTable());
    const t = useApp.getState().datasets[0].peakTable!;
    expect(t.provenance.background).toBe(label);
    expect(t.peaks[0].bg).toBeCloseTo(bg, 12);
  });
});

describe("useModelFit — request", () => {
  it("is the default engine and posts shapes, background and every parameter over the cut segment", async () => {
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
    // the segment is already range-cut: re-sending the range only adds a 422 path
    expect(body).not.toHaveProperty("x_min");
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

  // Slice 3 changed this on purpose: edits live in the recipe and FOLLOW
  // THEIR PEAK (slice 2 dropped every edit on any peak-list change).
  it("table edits survive re-renders and follow their peak when another is excluded; Defaults clears them", () => {
    const { result } = wizardWithTwoPeaks();
    const param = (n: string) => result.current.model.setup.params.find((p) => p.name === n);
    act(() => result.current.model.patch("p0.fwhm", { max: 3 }));
    act(() => result.current.model.patch("p1.height", { vary: false }));
    act(() => result.current.patchRecipe({ report: { regionWidth: 4 } })); // unrelated re-render
    expect(param("p0.fwhm")?.max).toBe(3);
    act(() => result.current.togglePeak(0)); // peak #2 becomes p0 and takes its edit along
    expect(result.current.model.setup.shapes).toHaveLength(1);
    expect(param("p0.height")?.vary).toBe(false);
    expect(param("p0.fwhm")?.max).not.toBe(3); // peak #1's edit left with peak #1
    act(() => result.current.togglePeak(0)); // back in, at index 0: a fresh seed there
    expect(param("p0.height")?.vary).toBe(true);
    expect(param("p1.height")?.vary).toBe(false);
    act(() => result.current.model.resetSetup());
    expect(param("p1.height")?.vary).toBe(true);
    expect(result.current.recipe.fit.params).toEqual({});
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

  it("refuses a table the backend would reject, without a request", async () => {
    stubFetch(() => json(200, modelFitResponse()));
    const { result } = wizardWithTwoPeaks();
    act(() => result.current.model.patch("p1.fwhm", { tie: "p0.fwhm" }));
    act(() => result.current.model.patch("p0.fwhm", { vary: false }));
    expect(result.current.model.problems).toHaveLength(1);
    await act(() => result.current.model.run());
    expect(result.current.model.error).toMatch(/^fix the parameter table first: #2 FWHM is tied to #1 FWHM, which is fixed/);
    expect(calls).toHaveLength(0);
  });

  it("refuses to run with no included peak, without a request", async () => {
    stubFetch(() => json(200, modelFitResponse()));
    const { result } = renderHook(() => usePeakWizard());
    await act(() => result.current.model.run());
    expect(result.current.model.error).toBe("include at least one peak first");
    expect(calls).toHaveLength(0);
  });
});

describe("useModelFit — overlays", () => {
  it("draws model + background on the rows the fit saw, 1:1 by position", async () => {
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
  });

  it("an up/down sweep (repeated x) maps each fitted point to its own row", async () => {
    const sweepX = [0, 1, 2, 3, 2, 1, 0];
    useApp.setState({
      datasets: [{ id: "d1", name: "sweep", data: { ...DATA, time: sweepX, values: sweepX.map((_, i) => [i]) } }],
    });
    const res = modelFitResponse();
    res.curves.x = sweepX;
    res.curves.model = [10, 11, 12, 13, 14, 15, 16];
    res.curves.background = sweepX.map(() => 0);
    stubFetch(() => json(200, res));
    const { result } = renderHook(() => usePeakWizard());
    act(() => result.current.addPeakAt(3));
    await act(() => result.current.model.run());
    // by x value, rows 4..6 would have repeated rows 2..0's values
    expect(useApp.getState().fitOverlay?.y).toEqual([10, 11, 12, 13, 14, 15, 16]);
  });

  it("skips excluded rows: the fitted points land on the rows they came from", async () => {
    useApp.setState({ datasets: [{ id: "d1", name: "scan", data: DATA, excludedRows: [1] }] });
    const res = modelFitResponse();
    res.curves.x = [0, 0.2, 0.3];
    res.curves.model = [5, 6, 7];
    res.curves.background = [0, 0, 0];
    stubFetch(() => json(200, res));
    const { result } = wizardWithTwoPeaks();
    await act(() => result.current.model.run());
    expect(useApp.getState().fitOverlay?.y.slice(0, 5)).toEqual([5, null, 6, 7, null]);
  });
});

describe("useModelFit — invalidation from the content key", () => {
  it("a table edit makes the fit stale: overlays off, integrate and report blocked", async () => {
    stubFetch(() => json(200, modelFitResponse()));
    const { result } = wizardWithTwoPeaks();
    await act(() => result.current.model.run());
    expect(result.current.canReportFit).toBe(true);
    act(() => result.current.model.patch("p0.center", { min: 1 }));
    expect(result.current.model.stale).toBe(true);
    expect(result.current.model.result).not.toBeNull(); // still shown, marked stale
    expect(result.current.canReportFit).toBe(false);
    expect(result.current.reportBlock).toMatch(/re-fit in step 4/);
    expect(useApp.getState().fitOverlay).toBeNull();
    const before = calls.length;
    await act(() => result.current.runIntegrate());
    expect(result.current.fitError).toBe(result.current.reportBlock);
    expect(calls.length).toBe(before); // no integration request
    act(() => result.current.model.startFromResult());
    expect(result.current.model.setup.params.find((p) => p.name === "p0.center")?.value).toBe(2.01);
  });

  it("toggling a peak drops the result, the overlays and makes nothing reportable", async () => {
    stubFetch(() => json(200, modelFitResponse()));
    const { result } = wizardWithTwoPeaks();
    await act(() => result.current.model.run());
    expect(useApp.getState().fitOverlay).not.toBeNull();
    act(() => result.current.togglePeak(1));
    expect(result.current.model.result).toBeNull();
    expect(result.current.canReportFit).toBe(false);
    expect(useApp.getState().fitOverlay).toBeNull();
    expect(useApp.getState().baselineOverlay).toBeNull(); // baseline "none": no preview to restore
  });

  it("a same-id data change drops the result", async () => {
    stubFetch(() => json(200, modelFitResponse()));
    const { result } = wizardWithTwoPeaks();
    await act(() => result.current.model.run());
    const edited = { ...DATA, values: DATA.values.map((r, i) => (i === 10 ? [r[0] + 1] : r)) };
    act(() => useApp.setState({ datasets: [{ id: "d1", name: "scan", data: edited }] }));
    expect(result.current.model.result).toBeNull();
  });

  it("a report-only setting keeps the fit; a model input drops it", async () => {
    stubFetch(() => json(200, modelFitResponse()));
    const { result } = wizardWithTwoPeaks();
    await act(() => result.current.model.run());
    act(() => result.current.patchRecipe({ report: { mode: "integrate" } }));
    expect(result.current.model.result).not.toBeNull();
    expect(result.current.canReportFit).toBe(true);
    act(() => result.current.patchRecipe({ model: { shape: "Lorentzian" } }));
    expect(result.current.model.result).toBeNull();
    expect(result.current.canReportFit).toBe(false);
  });

  it("a new model fit or an engine switch clears an integration seeded from the old one", async () => {
    stubFetch((i) => (calls[i].url === "/api/peaks/integrate"
      ? json(200, { peaks: [], total_area: 0, baseline: "linear" })
      : json(200, modelFitResponse({ message: `fit ${i}` }))));
    const { result } = wizardWithTwoPeaks();
    await act(() => result.current.model.run());
    await act(() => result.current.runIntegrate());
    expect(result.current.integrateResult).not.toBeNull();
    await act(() => result.current.model.run());
    expect(result.current.integrateResult).toBeNull();
    await act(() => result.current.runIntegrate());
    expect(result.current.integrateResult).not.toBeNull();
    act(() => result.current.model.setEngine("classic"));
    expect(result.current.integrateResult).toBeNull();
  });

  it("switching the active dataset drops the result and never restores the OLD baseline onto the new one", async () => {
    // d1's baseline is 0.25 everywhere; any later (d2) estimate is 0.5 — so an
    // overlay tagged d2 carrying 0.25 can only be d1's baseline restored.
    let alsCalls = 0;
    stubFetch((i) => (calls[i].url === "/api/baseline/als"
      ? json(200, { baseline: DATA.time.map(() => (alsCalls++ === 0 ? 0.25 : 0.5)) })
      : json(200, modelFitResponse())));
    useApp.setState({ datasets: [...useApp.getState().datasets, { id: "d2", name: "other", data: DATA }] });
    const { result } = wizardWithTwoPeaks();
    act(() => result.current.patchRecipe({ baseline: { method: "als" } }));
    await waitFor(() => expect(useApp.getState().baselineOverlay?.y[0]).toBe(0.25));
    await act(() => result.current.model.run());
    expect(result.current.model.result).not.toBeNull();
    const ours = useApp.getState().baselineOverlay;
    expect(ours?.datasetId).toBe("d1");
    expect(ours?.y[0]).not.toBe(0.25); // the fitted background (+ baseline) replaced the preview
    act(() => useApp.setState({ activeId: "d2" }));
    expect(result.current.model.result).toBeNull();
    expect(useApp.getState().fitOverlay).toBeNull();
    const after = useApp.getState().baselineOverlay;
    expect(after === null || (after.datasetId === "d2" && after.y[0] === 0.5)).toBe(true);
  });

  it("within one dataset, invalidation restores the step-1 baseline preview", async () => {
    const ALS = DATA.time.map(() => 0.25);
    stubFetch((i) => (calls[i].url === "/api/baseline/als"
      ? json(200, { baseline: ALS })
      : json(200, modelFitResponse())));
    const { result } = wizardWithTwoPeaks();
    act(() => result.current.patchRecipe({ baseline: { method: "als" } }));
    await waitFor(() => expect(useApp.getState().baselineOverlay?.y[0]).toBe(0.25));
    await act(() => result.current.model.run());
    expect(useApp.getState().baselineOverlay?.y[0]).not.toBe(0.25);
    act(() => result.current.togglePeak(0));
    expect(useApp.getState().baselineOverlay).toMatchObject({ datasetId: "d1" });
    expect(useApp.getState().baselineOverlay?.y[0]).toBe(0.25);
  });
});
