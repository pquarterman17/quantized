// Plot recipe v2 capture (F4.2 / audit P1.3): the preview thumbnail data,
// the outlier (excluded-row) policy, and the transformation reference.

import { describe, expect, it } from "vitest";

import { captureRecipe } from "./plotRecipe";
import { capturePreview, previewGlyph } from "./plotRecipePreview";
import type { RecipePanel } from "./plotRecipeSchema";
import { defaultPlotView, type PlotView } from "./plotview";
import type { Dataset } from "./types";

function ds(overrides: Partial<Dataset> = {}, metadata: Record<string, unknown> = {}): Dataset {
  return {
    id: "d1",
    name: "scan.xy",
    data: {
      time: [0, 1, 2, 3, 4],
      values: [[0, 1, 10], [1, 10, 20], [2, 100, 30], [3, 1000, 40], [4, 10000, 50]],
      labels: ["x", "I", "J"],
      units: ["", "", ""],
      metadata: { technique: "xrd.powder", ...metadata },
    },
    ...overrides,
  };
}

const view = (o: Partial<PlotView> = {}): PlotView => ({ ...defaultPlotView(), xKey: 0, yKeys: [1], ...o });

describe("capturePreview", () => {
  it("normalizes each plotted series into [0, 1] on shared axes", () => {
    const p = capturePreview(ds(), view({ yKeys: [2] }));
    expect(p).toEqual({ series: [[[0, 0], [0.25, 0.25], [0.5, 0.5], [0.75, 0.75], [1, 1]]] });
  });

  it("normalizes in log space when the axis is log", () => {
    const p = capturePreview(ds(), view({ yScale: "log" }));
    expect(p?.series[0].map((pt) => pt[1])).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it("keeps the original row order for a non-monotonic X (a loop stays a loop)", () => {
    const loop = ds();
    loop.data = { ...loop.data, time: [0, 1, 2, 3], values: [[0, 0, 0], [2, 1, 1], [0, 2, 2], [-2, 1, 3]] };
    const p = capturePreview(loop, view());
    expect(p?.series[0].map((pt) => pt[0])).toEqual([0.5, 1, 0.5, 0]);
  });

  it("spaces a reciprocal axis by 1/x", () => {
    const p = capturePreview(ds(), view({ xKey: 2, yKeys: [0], xScale: "reciprocal" }));
    // x = 10..50 -> 1/x = 0.1 .. 0.02: the smallest x sits at the far end.
    expect(p?.series[0][0][0]).toBe(1);
    expect(p?.series[0][4][0]).toBe(0);
  });

  it("leaves out excluded rows and hidden series", () => {
    const p = capturePreview(ds({ excludedRows: [4] }), view({ yKeys: [1, 2], hiddenChannels: [1] }));
    expect(p?.series).toHaveLength(1);
    expect(p?.series[0].map((pt) => pt[0])).toEqual([0, 1 / 3, 2 / 3, 1].map((v) => Math.round(v * 1000) / 1000));
  });

  it("downsamples a long series to at most 48 points", () => {
    const n = 1000;
    const big = ds();
    big.data = { ...big.data, time: Array.from({ length: n }, (_, i) => i), values: Array.from({ length: n }, (_, i) => [i, i * i, 0]) };
    const p = capturePreview(big, view());
    expect(p?.series[0]).toHaveLength(48);
    expect(p?.series[0][0]).toEqual([0, 0]);
    expect(p?.series[0][47]).toEqual([1, 1]);
  });

  it("is null when there is nothing plottable", () => {
    expect(capturePreview(ds(), view({ yKeys: [] }))).toBeNull();
    expect(capturePreview(ds(), view({ yKeys: [9] }))).toBeNull();
  });
});

describe("captureRecipe v2 fields", () => {
  const opts = { id: "r1", name: "R", appVersion: "0", now: () => "2026-09-29T00:00:00.000Z" };

  it("records the preview, the outlier policy passed in, and no transform for a raw dataset", () => {
    const r = captureRecipe(ds(), view(), null, { ...opts, excludedDisplay: "grey" });
    expect(r.preview?.series).toHaveLength(1);
    expect(r.outlierPolicy).toEqual({ excludedDisplay: "grey" });
    expect(r.transform).toBeNull();
  });

  it("leaves the outlier policy unrecorded when the caller does not know it", () => {
    expect(captureRecipe(ds(), view(), null, opts).outlierPolicy).toBeNull();
  });

  it("records the transformation recipe a derived dataset came from", () => {
    const derived = ds({}, { transform_recipe: { recipe: "Normalize + bg", revision: 3, input: { id: "d0", name: "raw" } } });
    expect(captureRecipe(derived, view(), null, opts).transform).toEqual({ name: "Normalize + bg", revision: 3 });
  });

  it("ignores malformed transform provenance", () => {
    const bad = ds({}, { transform_recipe: { recipe: 42 } });
    expect(captureRecipe(bad, view(), null, opts).transform).toBeNull();
  });
});

// Q6 (b): the thumbnail reflects a v3 recipe's multi-panel layout (a grid
// glyph) and its map view, derived from what the recipe recorded.
describe("previewGlyph", () => {
  const panel = (row: number, col: number): RecipePanel => ({
    dataset: null, x: "x", y: ["I"], y2: [], xLim: [0, 1], yLim: [0, 1], y2Lim: null,
    xStep: null, yStep: null, y2Step: null, xLog: false, yLog: false, y2Log: false,
    seriesStyles: {}, seriesLabels: {}, hiddenChannels: [], errKeys: {}, annotations: [], regionShades: [], row, col,
  });
  const none = { panels: null, map: null };

  it("is a plain glyph for a single-panel recipe without a map", () => {
    expect(previewGlyph(none)).toEqual({ grid: null, map: false });
  });

  it("sizes a spatial composition's grid from its panels' cells", () => {
    const panels = { panels: [panel(0, 0), panel(0, 1), panel(1, 0)], panelFit: "frames" as const, pageSetup: null };
    expect(previewGlyph({ ...none, panels })).toEqual({ grid: { rows: 2, cols: 2 }, map: false });
  });

  it("shapes a composite panel window like the window itself does", () => {
    const pw = (layout: "row" | "column" | "grid" | "overlay", n: number) =>
      previewGlyph({ ...none, panelWindow: { datasets: Array.from({ length: n }, (_, i) => (i ? `d${i}` : null)), layout } }).grid;
    expect(pw("row", 3)).toEqual({ rows: 1, cols: 3 });
    expect(pw("column", 2)).toEqual({ rows: 2, cols: 1 });
    expect(pw("grid", 4)).toEqual({ rows: 2, cols: 2 });
    expect(pw("overlay", 3)).toBeNull(); // one shared plot, no grid
  });

  it("flags a recorded map view", () => {
    expect(previewGlyph({ ...none, map: { colormap: "magma", logZ: false, colorLimits: null } }).map).toBe(true);
  });
});
