// Analysis overlays (fit / baseline / peak markers) reach the figure export —
// round-3 plot audit: a peak fit or reflectivity fit drawn on the canvas was
// missing from every SVG/PDF, legend entry included.

import { describe, expect, it } from "vitest";

import type { FigureSpec } from "./api/figures";
import { resolveToHex } from "./color";
import type { StoreGet } from "./exportActive";
import { withAnalysisOverlays, type OverlayGrey, type OverlaySources, type OverlayView } from "./figureSpecOverlays";
import { buildStageFigureSpec } from "./figureSpecStage";
import { createFigureDocument } from "./figureDocument";
import { defaultPlotView } from "./plotview";
import { seriesColor } from "./seriesStyleCycle";
import type { Dataset } from "./types";
import { SINGLE_X } from "../test/overlayBinding";

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

/** A view plus its overlay sources, as one test fixture. */
type TestView = OverlayView & OverlaySources;

const VIEW: TestView = {
  fitOverlay: { datasetId: "d1", binding: SINGLE_X, y: [1.1, 4.9, 2.1, 0.9] },
  baselineOverlay: null,
  peakOverlay: { datasetId: "d1", binding: SINGLE_X, y: [null, 5, null, null] },
  plotTemplate: "screen",
  defaultLineWidth: 1.5,
  xKey: null,
  yKeys: null,
  seriesOrder: null,
  hiddenChannels: [],
  seriesStyles: {},
  waterfall: 0,
  facetKey: null,
  stackMode: false,
  polarMode: false,
  statMode: false,
  groupKey: null,
};

const overlay = (spec: FigureSpec, ds: Dataset, v: TestView, grey?: OverlayGrey) =>
  withAnalysisOverlays(spec, ds, v, v, grey);

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
  it("exports the Curve Fit band with its curve: dashed edges, each low edge filled to its high edge", () => {
    const band = [
      { label: "95% CI low", y: [1, 4.7, 2, 0.8], legend: "95% confidence band" },
      { label: "95% CI high", y: [1.2, 5.1, 2.2, 1], legend: "" },
      { label: "95% PI low", y: [0.5, 4, 1.5, 0.3], legend: "95% prediction band" },
      { label: "95% PI high", y: [1.7, 5.8, 2.7, 1.5], legend: "" },
    ];
    const view: TestView = { ...VIEW, fitOverlay: { datasetId: "d1", binding: SINGLE_X, y: [1.1, 4.9, 2.1, 0.9], band } };
    const out = overlay(flat(), DS, view);
    // Before the fix the band was dropped: fit and peaks only.
    expect(out.dataset.labels).toEqual(["Intensity", "fit", "95% CI low", "95% CI high", "95% PI low", "95% PI high", "peaks"]);
    expect(out.y_keys).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(col(out, 2)).toEqual([1, 4.7, 2, 0.8]);
    expect(col(out, 5)).toEqual([1.7, 5.8, 2.7, 1.5]);
    const styles = out.series_styles ?? [];
    const fitColor = resolveToHex(seriesColor(1));
    expect(styles[1]).toMatchObject({ legend: "fit", color: fitColor });
    // One legend entry per band (its lower edge); the upper edge has none.
    expect(styles[2]).toEqual({ color: fitColor, legend: "95% confidence band", line: "dashed", width: 1, fill: { vs: 3 } });
    expect(styles[3]).toEqual({ color: fitColor, legend: "", line: "dashed", width: 1 });
    expect(styles[4]).toEqual({ color: fitColor, legend: "95% prediction band", line: "dashed", width: 1, fill: { vs: 5 } });
    expect(styles[5]).toEqual({ color: fitColor, legend: "", line: "dashed", width: 1 });
    // The peaks keep the palette slot of their canvas display position (after the edges).
    expect(styles[6]).toMatchObject({ legend: "peaks", color: resolveToHex(seriesColor(6)) });
  });

  it("drops a band whose edges do not span the worksheet, keeping the curve", () => {
    const view: TestView = { ...VIEW, peakOverlay: null, fitOverlay: { datasetId: "d1", binding: SINGLE_X, y: [1.1, 4.9, 2.1, 0.9], band: [{ label: "lo", y: [1] }, { label: "hi", y: [2] }] } };
    expect(overlay(flat(), DS, view).dataset.labels).toEqual(["Intensity", "fit"]);
  });

  it("appends the fit as a line and the peaks as markers, each with a legend entry", () => {
    const out = overlay(flat(), DS, VIEW);
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
    const other: TestView = { ...VIEW, fitOverlay: { datasetId: "d2", binding: SINGLE_X, y: [1, 2, 3, 4] }, peakOverlay: null };
    expect(overlay(spec, DS, other)).toBe(spec);
  });

  it("drops an overlay shorter than the data (the canvas cannot align it either)", () => {
    const short: TestView = { ...VIEW, fitOverlay: { datasetId: "d1", binding: SINGLE_X, y: [1, 2] }, peakOverlay: null };
    expect(overlay(flat(), DS, short).y_keys).toEqual([0]);
  });

  it("extends every y_keys-aligned list so nothing misaligns", () => {
    const out = overlay(
      flat({ error_spans: [null], waterfall_offsets: [0], log_offsets: [0] }),
      DS,
      { ...VIEW, peakOverlay: null },
    );
    expect(out.error_spans).toEqual([null, null]);
    expect(out.waterfall_offsets).toEqual([0, 0]);
    expect(out.log_offsets).toEqual([0, 0]);
  });

  it("scales the overlay by its parent's decade offset, as the canvas does", () => {
    const view = { ...VIEW, peakOverlay: null, seriesStyles: { 0: { logOffset: 2 } } };
    const out = overlay(flat({ log_offsets: [2] }), DS, view);
    expect(col(out, 1)).toEqual([110.00000000000001, 490.00000000000006, 210, 90]);
    expect(out.log_offsets).toEqual([2, 0]);
  });

  // Two channels A (0) and B (1); the fit is bound to A.
  const TWO: Dataset = {
    ...DS,
    data: { ...DS.data, values: [[1, 7], [5, 7], [2, 7], [1, 7]], labels: ["A", "B"], units: ["", ""] },
  };

  it("does not export a fit whose curve the view does not draw (canvas parity: it is not drawn there)", () => {
    // The view shows only B; a fit of A is placed nowhere on the canvas
    // (lib/overlayPlacement: bound Y not shown), so the export carries none --
    // not one scaled by A's offset on a figure that does not contain A.
    const view: TestView = { ...VIEW, peakOverlay: null, yKeys: [1], seriesStyles: { 0: { logOffset: 3 } } };
    const spec = { ...flat(), dataset: TWO.data, y_keys: [1] };
    expect(overlay(spec, TWO, view)).toBe(spec);
    expect(overlay(spec, TWO, { ...view, hiddenChannels: [0], yKeys: null })).toBe(spec);
  });

  it("appends nothing when the spec's curves are not the view's (never a mix of two sources)", () => {
    // The view shows A and B, the request lists only B: they were not built
    // from the same view, so no overlay decision can be trusted.
    const spec = { ...flat(), dataset: TWO.data, y_keys: [1] };
    expect(overlay(spec, TWO, { ...VIEW, peakOverlay: null, yKeys: null })).toBe(spec);
  });

  it("a repeated Y channel is one curve: its overlays still ride", () => {
    const spec = { ...flat(), dataset: TWO.data, y_keys: [0, 1] };
    expect(overlay(spec, TWO, { ...VIEW, peakOverlay: null, yKeys: [0, 0, 1] }).dataset.labels).toContain("fit");
  });

  it("scales the fit by its bound curve's offset, under the predicate logOffsetWire uses", () => {
    const view: TestView = { ...VIEW, peakOverlay: null, yKeys: null, seriesStyles: { 0: { logOffset: 3 } } };
    const spec = { ...flat({ log_offsets: [3, 0] }), dataset: TWO.data, y_keys: [0, 1] };
    expect(col(overlay(spec, TWO, view), 2)).toEqual([1.1, 4.9, 2.1, 0.9].map((v) => v * 1000));
    // A view the canvas does not offset in (waterfall) leaves it unscaled.
    const wf = overlay({ ...spec, log_offsets: undefined }, TWO, { ...view, waterfall: 0.5 });
    expect(col(wf, 2)).toEqual([1.1, 4.9, 2.1, 0.9]);
  });

  it("prunes the overlay to the rows a hide-mode export keeps", () => {
    const ds: Dataset = { ...DS, excludedRows: [1] };
    const pruned = flat({
      dataset: { ...DS.data, time: [10, 30, 40], values: [[1], [2], [1]] },
    });
    const out = overlay(pruned, ds, { ...VIEW, peakOverlay: null });
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
    const out = overlay(ghost, ds, { ...VIEW, peakOverlay: null }, {
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
      expect(overlay(spec, DS, VIEW)).toBe(spec);
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
