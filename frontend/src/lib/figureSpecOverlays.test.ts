// Analysis overlays (fit / baseline / peak markers) reach the figure export —
// round-3 plot audit: a peak fit or reflectivity fit drawn on the canvas was
// missing from every SVG/PDF, legend entry included.

import { describe, expect, it } from "vitest";

import type { FigureSpec } from "./api/figures";
import { resolveToHex } from "./color";
import type { StoreGet } from "./exportActive";
import { withAnalysisOverlays, type OverlayView } from "./figureSpecOverlays";
import { buildStageFigureSpec } from "./figureSpecStage";
import { createFigureDocument } from "./figureDocument";
import { defaultPlotView } from "./plotview";
import { seriesColor } from "./seriesStyleCycle";
import type { Dataset } from "./types";

const DS: Dataset = {
  id: "d1",
  name: "xrd.raw",
  data: {
    time: [10, 20, 30, 40],
    values: [[1], [5], [2], [1]],
    labels: ["Intensity"],
    units: ["counts"],
    metadata: {},
  },
};

const VIEW: OverlayView = {
  fitOverlay: { datasetId: "d1", y: [1.1, 4.9, 2.1, 0.9] },
  baselineOverlay: null,
  peakOverlay: { datasetId: "d1", y: [null, 5, null, null] },
  plotTemplate: "screen",
  defaultLineWidth: 1.5,
};

function flat(over: Partial<FigureSpec> = {}): FigureSpec {
  return {
    dataset: DS.data,
    y_keys: [0],
    series_styles: [{ color: "#111111", width: 1.5 }],
    fmt: "svg",
    ...over,
  };
}

const col = (spec: FigureSpec, k: number) => spec.dataset.values.map((r) => r[k]);

describe("withAnalysisOverlays", () => {
  it("appends the fit as a line and the peaks as markers, each with a legend entry", () => {
    const out = withAnalysisOverlays(flat(), DS, VIEW, 1);
    expect(out.y_keys).toEqual([0, 1, 2]);
    expect(out.dataset.labels).toEqual(["Intensity", "fit", "peaks"]);
    expect(col(out, 1)).toEqual([1.1, 4.9, 2.1, 0.9]);
    expect(col(out, 2).map((v) => (Number.isNaN(v) ? null : v))).toEqual([null, 5, null, null]);
    const [, fit, peaks] = out.series_styles ?? [];
    expect(fit).toMatchObject({ legend: "fit", width: 1.5 });
    expect(fit?.line).toBeUndefined();
    expect(peaks).toMatchObject({ legend: "peaks", line: "none", marker: true, marker_size: 8 });
    // The palette slot at the overlay's DISPLAY position on the canvas — after
    // the one plotted channel — exactly as `uplotSeries` colours it.
    expect(fit?.color).toBe(resolveToHex(seriesColor(1)));
    expect(peaks?.color).toBe(resolveToHex(seriesColor(2)));
  });

  it("keeps the source spec untouched when no overlay belongs to the exported dataset", () => {
    const spec = flat();
    const other: OverlayView = { ...VIEW, fitOverlay: { datasetId: "d2", y: [1, 2, 3, 4] }, peakOverlay: null };
    expect(withAnalysisOverlays(spec, DS, other, 1)).toBe(spec);
  });

  it("drops an overlay shorter than the data (the canvas cannot align it either)", () => {
    const short: OverlayView = { ...VIEW, fitOverlay: { datasetId: "d1", y: [1, 2] }, peakOverlay: null };
    expect(withAnalysisOverlays(flat(), DS, short, 1).y_keys).toEqual([0]);
  });

  it("extends every y_keys-aligned list so nothing misaligns", () => {
    const out = withAnalysisOverlays(
      flat({ error_spans: [null], waterfall_offsets: [0], log_offsets: [0] }),
      DS,
      { ...VIEW, peakOverlay: null },
      1,
    );
    expect(out.error_spans).toEqual([null, null]);
    expect(out.waterfall_offsets).toEqual([0, 0]);
    expect(out.log_offsets).toEqual([0, 0]);
  });

  it("scales the overlay by its parent's decade offset, as the canvas does", () => {
    const out = withAnalysisOverlays(flat({ log_offsets: [2] }), DS, { ...VIEW, peakOverlay: null }, 1);
    expect(col(out, 1)).toEqual([110.00000000000001, 490.00000000000006, 210, 90]);
    expect(out.log_offsets).toEqual([2, 0]);
  });

  it("prunes the overlay to the rows a hide-mode export keeps", () => {
    const ds: Dataset = { ...DS, excludedRows: [1] };
    const pruned = flat({
      dataset: { ...DS.data, time: [10, 30, 40], values: [[1], [2], [1]] },
    });
    const out = withAnalysisOverlays(pruned, ds, { ...VIEW, peakOverlay: null }, 1);
    expect(col(out, 1)).toEqual([1.1, 2.1, 0.9]);
  });

  it("leaves the overlay blank on the greyed rows a ghost export appends", () => {
    const ds: Dataset = { ...DS, excludedRows: [1] };
    const ghost = flat({
      dataset: {
        ...DS.data,
        time: [10, 30, 40, 20],
        values: [[1, NaN], [2, NaN], [1, NaN], [NaN, 5]],
        labels: ["Intensity", "Intensity (excluded)"],
        units: ["counts", "counts"],
      },
      y_keys: [0, 1],
      series_styles: [{ color: "#111111" }, { color: "#999999" }],
    });
    const out = withAnalysisOverlays(ghost, ds, { ...VIEW, peakOverlay: null }, 1, {
      screen: true,
      wire: true,
    });
    expect(out.y_keys).toEqual([0, 1, 2]);
    expect(col(out, 2).slice(0, 3)).toEqual([1.1, 2.1, 0.9]);
    expect(Number.isNaN(col(out, 2)[3])).toBe(true);
    // The canvas draws the grey companion before the fit: palette slot 2.
    expect(out.series_styles?.[2]?.color).toBe(resolveToHex(seriesColor(2)));
  });

  it("does not touch request shapes the overlays cannot ride", () => {
    for (const over of [{ group_col: 0 }, { facets: [] }, { encoding: {} }] as Partial<FigureSpec>[]) {
      const spec = flat(over);
      expect(withAnalysisOverlays(spec, DS, VIEW, 1)).toBe(spec);
    }
  });
});

describe("buildStageFigureSpec carries the canvas' analysis overlays", () => {
  it("a peak fit on the focused plot reaches the export request", () => {
    const view = { ...defaultPlotView(), yKeys: [0] };
    const document = createFigureDocument({ id: "w1-doc", name: "Fit", datasetId: "d1", view });
    const get = (() => ({
      ...view,
      focusedWindowId: "w1",
      windowsForSave: () => [{ id: "w1", kind: "plot", document }],
      autoSeriesStyles: false,
      defaultTrace: "Line",
      defaultLineWidth: 1.5,
      excludedDisplay: "grey",
      fitOverlay: VIEW.fitOverlay,
      baselineOverlay: null,
      peakOverlay: VIEW.peakOverlay,
    })) as unknown as StoreGet;
    const spec = buildStageFigureSpec(get, DS, "xrd", {
      fmt: "svg", style: "default", dpi: 300, title: "", xLabel: "", yLabel: "",
    });
    expect(spec.dataset.labels).toEqual(["Intensity", "fit", "peaks"]);
    expect(spec.y_keys).toEqual([0, 1, 2]);
  });
});
