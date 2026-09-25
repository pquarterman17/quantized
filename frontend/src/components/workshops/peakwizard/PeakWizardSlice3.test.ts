// Peak Analyzer, audit P2.4 slice 3, through usePeakWizard with a stubbed
// fetch (real request builders, real hooks): recipe v2 carrying the model
// configuration end to end, direct add into the model table, deleting a peak
// from the model table, the "Fit this range" hand-off, and the step-① baseline
// preview on the right rows when rows are excluded. Waits are on STATE.

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { requestPeakFitRange, usePeakFitRange } from "../../../store/peakFitRange";
import { useToasts } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import { usePeakWizard } from "./usePeakWizard";

// x = 0..5.9 step 0.1: Gaussians at x = 2 (sigma 0.2) and x = 4 on a floor of 1.
const N = 60;
const X = Array.from({ length: N }, (_, i) => i / 10);
const Y = X.map((_, i) => 1 + Math.exp(-((i - 20) ** 2) / 8) + 0.5 * Math.exp(-((i - 40) ** 2) / 8));
const DATA: DataStruct = { time: X, values: Y.map((v) => [v]), labels: ["I"], units: ["cts"], metadata: {} };

interface Call { url: string; body: Record<string, unknown> }
let calls: Call[] = [];
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const detected = (center: number, height: number) => ({ center, height, bg: 0, fwhm: 0.47, prominence: height, localSNR: 20, area: null });

/** /api/peaks/find answers the two Gaussians; ALS answers `als(y)` for the y it was sent. */
function stubFetch(als: (y: number[]) => number[] = (y) => y.map(() => 0.25)) {
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    calls.push({ url, body });
    if (url === "/api/peaks/find") return Promise.resolve(json({ peaks: [detected(2, 2), detected(4, 1.5)], background: [] }));
    if (url === "/api/baseline/als") return Promise.resolve(json({ baseline: als(body.y as number[]) }));
    return Promise.reject(new Error(`unexpected ${url}`));
  });
}

beforeEach(() => {
  calls = [];
  localStorage.clear();
  usePeakFitRange.setState({ request: null });
  useToasts.setState({ toasts: [] });
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

const param = (r: { current: ReturnType<typeof usePeakWizard> }, n: string) =>
  r.current.model.setup.params.find((p) => p.name === n);

describe("recipe v2 through the wizard", () => {
  it("saves the engine, shapes, background and table edits, and a fresh wizard re-applies them over the NEW seed", async () => {
    stubFetch();
    const first = renderHook(() => usePeakWizard());
    await act(() => first.result.current.runFind());
    act(() => first.result.current.model.setShape(1, "lorentzian"));
    act(() => first.result.current.model.setBackground("constant"));
    act(() => first.result.current.model.patch("p0.center", { min: 1.8, max: 2.2 }));
    act(() => first.result.current.model.patch("p1.height", { vary: false, value: 0.4 }));
    act(() => first.result.current.model.toggleShareFwhm());
    act(() => first.result.current.saveRecipe("two"));
    const saved = first.result.current.recipe.fit;
    expect(saved).toEqual({
      engine: "model",
      shapes: [null, "lorentzian"],
      background: "constant",
      params: { "p0.center": { min: 1.8, max: 2.2 }, "p1.height": { vary: false, value: 0.4 }, "p1.fwhm": { tie: "p0.fwhm" } },
      shareVary: {},
    });
    first.unmount();

    const second = renderHook(() => usePeakWizard());
    expect(second.result.current.recipes.map((r) => r.name)).toEqual(["two"]);
    act(() => second.result.current.applyRecipe("two"));
    expect(second.result.current.recipe.fit).toEqual(saved); // exact round trip
    act(() => second.result.current.patchRecipe({ range: { lo: 0.5 } })); // a different window -> a different seed
    await act(() => second.result.current.runFind());
    const s = second.result.current.model.setup;
    expect(s.shapes).toEqual(["gaussian", "lorentzian"]);
    expect(s.background).toBe("constant");
    expect(param(second.result, "p0.center")).toMatchObject({ value: 2, min: 1.8, max: 2.2 }); // value re-seeded
    expect(param(second.result, "p1.height")).toMatchObject({ vary: false, value: 0.4 });
    expect(param(second.result, "p1.fwhm")?.tie).toBe("p0.fwhm");
    expect(second.result.current.model.fwhmShared).toBe(true);
  });

  it("an engine choice travels with the recipe", () => {
    stubFetch();
    const { result } = renderHook(() => usePeakWizard());
    act(() => result.current.model.setEngine("classic"));
    act(() => result.current.saveRecipe("classic one"));
    act(() => result.current.model.setEngine("model"));
    act(() => result.current.applyRecipe("classic one"));
    expect(result.current.model.engine).toBe("classic");
  });
});

describe("direct add and delete in the model", () => {
  it("a click near a peak adds a data-seeded candidate that becomes the next model peak, keeping the other edits", async () => {
    stubFetch();
    const { result } = renderHook(() => usePeakWizard());
    await act(() => result.current.runFind());
    act(() => result.current.removePeak(1)); // leaves the peak at 2
    act(() => result.current.model.patch("p0.fwhm", { max: 1 }));
    act(() => result.current.addPeakAt(4.13)); // a click just off the apex at 4
    const added = result.current.candidates[1];
    expect(added).toMatchObject({ center: 4, manual: true, bg: 0 });
    expect(added.fwhm).toBeGreaterThan(0.4); // sigma 0.2 -> FWHM 0.47
    expect(added.fwhm).toBeLessThan(0.55);
    expect(param(result, "p1.center")?.value).toBe(4);
    expect(param(result, "p1.fwhm")?.value).toBeCloseTo(added.fwhm);
    expect(param(result, "p0.fwhm")?.max).toBe(1); // the existing peak's edit survived the add
  });

  it("deleting a peak from the model table drops its rows and moves later peaks' edits down", async () => {
    stubFetch();
    const { result } = renderHook(() => usePeakWizard());
    await act(() => result.current.runFind());
    act(() => result.current.addPeakAt(5));
    act(() => result.current.model.patch("p1.center", { min: 3.9 }));
    act(() => result.current.model.patch("p2.height", { vary: false }));
    act(() => result.current.removeModelPeak(0));
    expect(result.current.candidates.map((c) => c.center)).toEqual([4, 5]);
    expect(result.current.model.setup.shapes).toHaveLength(2);
    expect(param(result, "p0.center")?.min).toBe(3.9);
    expect(param(result, "p1.height")?.vary).toBe(false);
    expect(param(result, "p2.center")).toBeUndefined();
  });
});

describe("Peak Fitting ▸ Fit this range", () => {
  it("applies the requested range, goes to step 2 and finds peaks on that range only", async () => {
    stubFetch();
    const { result } = renderHook(() => usePeakWizard());
    act(() => requestPeakFitRange("d1", 4.5, 3.5));
    await waitFor(() => expect(result.current.candidates).toHaveLength(2));
    expect(result.current.recipe.range).toEqual({ lo: 3.5, hi: 4.5 });
    expect(result.current.step).toBe(1);
    const find = calls.filter((c) => c.url === "/api/peaks/find");
    expect(find).toHaveLength(1);
    expect((find[0].body.x as number[])[0]).toBeCloseTo(3.5);
    expect((find[0].body.x as number[]).at(-1)).toBeCloseTo(4.5);
    expect(usePeakFitRange.getState().request).toBeNull(); // consumed
  });

  it("with a baseline, waits for THAT range's estimate and finds peaks on the corrected trace", async () => {
    // baseline = half the y it was estimated on, point for point — so an
    // estimate for the OLD (full) range, index-shifted onto the new one,
    // would subtract the wrong values
    stubFetch((y) => y.map((v) => v / 2));
    const { result } = renderHook(() => usePeakWizard());
    act(() => result.current.patchRecipe({ baseline: { method: "als" } }));
    await waitFor(() => expect(useApp.getState().baselineOverlay).not.toBeNull());
    act(() => requestPeakFitRange("d1", 1, 3));
    await waitFor(() => expect(calls.filter((c) => c.url === "/api/peaks/find")).toHaveLength(1));
    const find = calls.find((c) => c.url === "/api/peaks/find")!;
    const sentX = find.body.x as number[];
    const sentY = find.body.y as number[];
    expect(sentX[0]).toBeCloseTo(1);
    sentX.forEach((x, i) => expect(sentY[i]).toBeCloseTo(Y[Math.round(x * 10)] / 2));
  });

  it("refuses a range selected on another dataset, and says so", async () => {
    stubFetch();
    const { result } = renderHook(() => usePeakWizard());
    act(() => requestPeakFitRange("d2", 1, 2));
    await waitFor(() => expect(usePeakFitRange.getState().request).toBeNull());
    expect(result.current.recipe.range).toEqual({ lo: null, hi: null });
    expect(calls).toHaveLength(0);
    expect(useToasts.getState().toasts.map((t) => t.msg).join()).toMatch(/another dataset/);
  });
});

describe("step-1 baseline busy state", () => {
  it("switching to no baseline mid-estimate clears 'estimating'", async () => {
    vi.stubGlobal("fetch", () => new Promise<Response>(() => {})); // the estimate never answers
    const { result } = renderHook(() => usePeakWizard());
    act(() => result.current.patchRecipe({ baseline: { method: "als" } }));
    await waitFor(() => expect(result.current.baselineBusy).toBe(true));
    act(() => result.current.patchRecipe({ baseline: { method: "none" } }));
    expect(result.current.baselineBusy).toBe(false);
  });
});

describe("step-1 baseline preview with excluded rows (slice-2 review bug)", () => {
  it("lands each baseline value on the row it was computed for", async () => {
    useApp.setState({ datasets: [{ id: "d1", name: "scan", data: DATA, excludedRows: [1] }] });
    stubFetch((ys) => ys.map((_, i) => 100 + i)); // value = 100 + segment index
    const { result } = renderHook(() => usePeakWizard());
    act(() => result.current.patchRecipe({ baseline: { method: "als" } }));
    await waitFor(() => expect(useApp.getState().baselineOverlay).not.toBeNull());
    const y = useApp.getState().baselineOverlay!.y;
    // segment point 0 = row 0, point 1 = row 2 (row 1 excluded), point 2 = row 3
    expect(y.slice(0, 4)).toEqual([100, null, 101, 102]);
    expect(y[N - 1]).toBe(100 + N - 2);
  });
});
