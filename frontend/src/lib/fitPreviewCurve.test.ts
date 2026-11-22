// The initial-guess preview composed onto a drawn payload: evaluated with the
// shared model expressions, drawn only for its own dataset and X channel, a
// dotted line that is never a fit.

import { renderHook, act } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useFitPreviewPayload } from "../components/Stage/useStageOverlays";
import { useApp } from "../store/useApp";
import { fitModelExpr } from "./derivedFitModels";
import { evaluatePreview, FIT_PREVIEW_LABEL, previewShifted, withFitPreview } from "./fitPreviewCurve";
import { setFitPreview, type FitPreviewCurve } from "./fitPreviewSlot";
import { DASH } from "./seriesStyleCycle";
import type { PlotPayload } from "./plotdata";
import { buildSeriesDefs } from "./uplotSeries";

const gaussian = fitModelExpr("Gaussian")!.expr;
const curve = (over: Partial<FitPreviewCurve> = {}): FitPreviewCurve => ({ datasetId: "d", xKey: null, expr: gaussian, params: [2, 1, 0.5], ...over });
const payload = (): PlotPayload =>
  ({ data: [[0, 1, 2], [1, 2, 3]], series: [{ label: "y", unit: "" }], xLabel: "x", xUnit: "" }) as PlotPayload;

afterEach(() => {
  setFitPreview(null);
  useApp.setState({ xKey: null });
});

describe("evaluatePreview", () => {
  it("evaluates the registry expression at the given x", () => {
    const y = evaluatePreview(gaussian, [2, 1, 0.5], [0, 1, 2])!;
    expect(y[1]).toBeCloseTo(2, 12);
    expect(y[0]).toBeCloseTo(2 * Math.exp(-2), 12);
    expect(y[0]).toBeCloseTo(y[2]!, 12);
  });
  it("is null where x is missing and where the model has no finite value", () => {
    expect(evaluatePreview(gaussian, [2, 1, 0.5], [null, Number.NaN])).toEqual([null, null]);
    expect(evaluatePreview(fitModelExpr("Curie-Weiss")!.expr, [1, 3], [3])).toEqual([null]); // 1/0
  });
  it("refuses an expression it cannot compile rather than drawing something", () => {
    expect(evaluatePreview("p0 +* x", [1], [1])).toBeNull();
  });
});

describe("withFitPreview", () => {
  it("appends one overlay series named initial guess, flagged as a preview and not as a fit", () => {
    const out = withFitPreview(payload(), curve(), { datasetId: "d", xKey: null })!;
    expect(out.data).toHaveLength(3);
    expect(out.series[1]).toEqual({ label: FIT_PREVIEW_LABEL, unit: "", overlay: true, preview: true });
    expect(out.series[1]!.fit).toBeUndefined();
    expect(FIT_PREVIEW_LABEL).toBe("initial guess");
  });
  it("leaves the payload untouched for another dataset, another X channel, no preview or a category axis", () => {
    const p = payload();
    expect(withFitPreview(p, curve(), { datasetId: "other", xKey: null })).toBe(p);
    expect(withFitPreview(p, curve(), { datasetId: "d", xKey: 3 })).toBe(p);
    expect(withFitPreview(p, null, { datasetId: "d", xKey: null })).toBe(p);
    const cat = { ...p, xCategories: ["a", "b", "c"] };
    expect(withFitPreview(cat, curve(), { datasetId: "d", xKey: null })).toBe(cat);
    expect(withFitPreview(p, curve({ expr: "p0 +* x" }), { datasetId: "d", xKey: null })).toBe(p);
  });
  it("is not drawn while a waterfall or decade offset shifts the plotted data", () => {
    const p = payload();
    expect(withFitPreview(p, curve(), { datasetId: "d", xKey: null, shifted: true })).toBe(p);
    expect(previewShifted(0, {})).toBe(false);
    expect(previewShifted(0.5, {})).toBe(true);
    expect(previewShifted(0, { 1: { logOffset: 2 } })).toBe(true);
    expect(previewShifted(0, { 1: { logOffset: 0 } })).toBe(false);
  });
  it("keeps a gap as a gap when the x column is a typed array", () => {
    const x = new Float64Array([0, Number.NaN, 2]);
    expect(evaluatePreview(gaussian, [2, 1, 0.5], x as unknown as number[])![1]).toBeNull();
  });
  it("evaluates at the plotted x, so a reduced (decimated) payload still lines up", () => {
    const p = { ...payload(), data: [[0, 2], [1, 3]], decimated: true } as PlotPayload;
    const out = withFitPreview(p, curve(), { datasetId: "d", xKey: null })!;
    expect((out.data[2] as number[]).length).toBe(2);
  });
});

describe("useFitPreviewPayload (the Stage's read)", () => {
  it("follows the slot and the plotted X, and is gone once the slot clears", () => {
    const p = payload();
    const { result } = renderHook(() => useFitPreviewPayload(p, "d"));
    expect(result.current).toBe(p);
    act(() => setFitPreview(curve()));
    expect(result.current!.series.at(-1)!.label).toBe("initial guess");
    act(() => useApp.setState({ xKey: 2 }));
    expect(result.current).toBe(p);
    act(() => useApp.setState({ xKey: null }));
    act(() => setFitPreview(null));
    expect(result.current).toBe(p);
  });
});

describe("preview series style", () => {
  it("draws a thin dotted line whatever the default trace, and does not give the data markers", () => {
    const p = withFitPreview(payload(), curve(), { datasetId: "d", xKey: null })!;
    const defs = buildSeriesDefs(p, { seriesStyles: [], baseLineWidth: 1.5, defaultTrace: "Scatter" }, p.series.map((s) => s.label), true, {
      accentColor: "#00f", inkColor: "#fff", inkDimColor: "#888", isDarkBg: true,
    }).series;
    expect(defs[2]!.dash).toEqual(DASH.dotted);
    expect(defs[2]!.width!).toBeLessThan(1.5);
    expect(defs[1]!.points?.show).toBe(true); // Scatter default: the data's own, unchanged by the preview
  });
});
