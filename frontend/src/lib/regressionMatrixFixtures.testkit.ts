// P4.2 canonical plot/project regression matrix — the NINE canonical figures
// plus the multi-panel page (TEN committed goldens in all).
//
// Built programmatically (no recorded JSON input) so they are deterministic on
// every platform, from ONE small dataset whose channels cover every binding the
// matrix needs. The committed goldens under
// `lib/__fixtures__/regressionMatrix/` are the canonical PROJECTION of each
// fixture, not the fixture itself — see `regressionMatrix.test.ts`.
//
// HOW TO ADD A FIXTURE: add a builder below, add its name to `MATRIX_FIXTURES`,
// then run `node scripts/freeze-regression-matrix.mjs` (from `frontend/`) and
// commit the new `<name>.json`.
//
// THE ONE FIXTURE THAT COULD NOT BE BUILT — "2-D". This repo has no first-class
// 2-D/heatmap FIGURE. `/api/export/map-figure` (contour/heatmap/surface) exists
// on the backend, but there is no frontend wrapper for it at all (stated in
// `lib/api/figures.ts`'s own doc), `PLOT_MARKS` (`lib/plotspec.ts`) has no 2-D
// member, and `FigureDocument` therefore has no representation for one — so a
// 2-D figure cannot be expressed on the document path the other three legs
// share. The map view is a separate, non-document surface (`lib/mapdata.ts`,
// `lib/mapRender.ts`). Documented gap, not a silent omission: `MATRIX_FIXTURES`
// holds NINE figure fixtures and the page fixture below makes TEN committed
// goldens.

import {
  createFigureDocument,
  type CreateFigureDocumentInput,
  type FigureDocument,
} from "./figureDocument";
import { createPageDocument } from "./pageDocumentActions";
import type { PageDocument } from "./pageDocument";
import { defaultPlotView, type PlotView } from "./plotview";
import type { Dataset, DataStruct, SeriesStyle } from "./types";

// Explicit per-series stroke overrides for the `decor` fixture.
//
// DISJOINT FROM `TEST_SERIES_PALETTE` BY CONSTRUCTION (review 2026-09-14).
// These used to be the palette's own first two slots, which made "the explicit
// `SeriesStyle.color` override wins" indistinguishable from "the palette slot
// was used": dropping `style?.color` in `lib/seriesStyleCycle.ts` left the
// whole matrix green. `regressionMatrix.test.ts`'s `decor` non-vacuity test now
// asserts both halves (`=== FIXTURE_COLORS[0]` AND
// `!== TEST_SERIES_PALETTE[0]`), which only bites while these two lists stay
// disjoint. Keep them so.
//
// Light, well-separated strokes: `lib/contrastColor.ts`'s `resolveDrawColor`
// substitutes a stroke that would be invisible on the canvas background, and
// jsdom reports the DARK theme (`document.documentElement.dataset.theme` is
// unset, and `uplotOpts`' `appThemeIsDark` treats anything but "light" as
// dark), so every literal colour here clears MIN_CONTRAST (2.2) there by a
// wide margin — measured contrast against `DARK_BG_LUMINANCE`: 14.4, 15.1,
// 8.7, 15.6.
export const FIXTURE_COLORS = ["#ffe066", "#66ffd9", "#ff8fa3", "#b0ff7f"] as const;

const ROWS = 6;

/** Channel map: 0 Signal, 1 Reference, 2 dSignal (sym y-err for 0),
 *  3 dRefPlus / 4 dRefMinus (asymmetric y-err for 1), 5 dX (x-err),
 *  6 Batch (categorical group), 7 Site (categorical facet), 8 Temp (y2). */
export function matrixData(): DataStruct {
  const values: number[][] = [];
  for (let r = 0; r < ROWS; r++) {
    values.push([
      r * 0.5,              // 0 Signal
      2 + r * 0.25,         // 1 Reference
      0.1,                  // 2 dSignal
      0.2,                  // 3 dRefPlus
      0.05,                 // 4 dRefMinus
      0.15,                 // 5 dX
      r % 3,                // 6 Batch  (codes 0,1,2)
      r < 3 ? 0 : 1,        // 7 Site   (codes 0,1)
      300 - r * 4,          // 8 Temp
    ]);
  }
  return {
    time: Array.from({ length: ROWS }, (_unused, r) => r),
    values,
    labels: ["Signal", "Reference", "dSignal", "dRefPlus", "dRefMinus", "dX", "Batch", "Site", "Temp"],
    units: ["au", "au", "au", "au", "au", "au", "", "", "K"],
    metadata: { x_column_long: "Index", x_column_unit: "" },
    cat_levels: { 6: ["A", "B", "C"], 7: ["north", "south"] },
    // A deliberately NON-ascending display order — the field a reopen or a
    // wire-prune can drop without changing anything else about the figure.
    level_order: { 6: [2, 0, 1] },
  };
}

export function matrixDataset(): Dataset {
  return { id: "matrix-ds", name: "matrix.csv", data: matrixData() };
}

/** The view every fixture starts from: explicit axis labels/limits (so the
 *  backend's own "derive label (unit)" fallback is not what is under test) and
 *  explicit per-series widths (so no leg has to invent a default width). */
function baseView(overrides: Partial<PlotView> = {}): PlotView {
  return {
    ...defaultPlotView(),
    xKey: null,
    yKeys: [0, 1],
    xAxisLabel: "Index",
    yAxisLabel: "Signal (au)",
    xLim: [0, 5] as [number, number],
    yLim: [-1, 4] as [number, number],
    showLegend: true,
    legendPos: "nw",
    plotTitle: "Matrix fixture",
    seriesStyles: { 0: { width: 2 }, 1: { width: 1 } },
    ...overrides,
  };
}

type FixtureExtras = Omit<CreateFigureDocumentInput, "id" | "name" | "datasetId" | "view">;

/** Named `makeFigure`, never `document`: a module-scope `function document`
 *  shadows the DOM global for this whole file, and its sibling
 *  `installSeriesPalette` (`regressionMatrix.testkit.ts`) depends on the real
 *  one. Same reason the legs testkit renamed its own `document` parameters. */
function makeFigure(id: string, view: PlotView, extra: FixtureExtras = {}): FigureDocument {
  return createFigureDocument({
    id,
    name: `matrix ${id}`,
    datasetId: "matrix-ds",
    view,
    output: { format: "pdf", stylePreset: "default", dpi: 300, transparent: false, filename: null },
    ...extra,
  });
}

// ── the eight single-figure fixtures ────────────────────────────────────────

export function plainFigure(): FigureDocument {
  return makeFigure("plain", baseView());
}

/** Symmetric Y (channel 2 -> series 0), ASYMMETRIC Y (channels 3/4 -> series
 *  1), and an X error (channel 5, target -1 = the plot's x axis). */
export function errorsFigure(): FigureDocument {
  return makeFigure("errors", baseView(), {
    errors: [
      { channel: 2, target: 0, axis: "y", side: "both" },
      { channel: 3, target: 1, axis: "y", side: "+" },
      { channel: 4, target: 1, axis: "y", side: "-" },
      { channel: 5, target: -1, axis: "x", side: "both" },
    ],
  });
}

/** One Y channel split by the categorical "Batch" column, whose explicit
 *  `level_order` is [C, A, B] rather than the ascending default.
 *
 *  The channel carries an explicit dash + width because that is what BUG-016
 *  is measured on: the canvas draws every level dashed and 2px, and since the
 *  fix `routes/export_figures.py`'s `group_col` branch expands the same
 *  `series_styles` entry onto each level instead of dropping it. Removing them
 *  would make both the equality test and the grouped legs' SHAPE comparison
 *  (`styleComparable("group").shape`) vacuous. No explicit COLOUR, deliberately:
 *  that is the half the wire cannot carry per level, so the fixture exercises
 *  the palette-cycling case the rule documents. */
export function groupFigure(): FigureDocument {
  return makeFigure(
    "group",
    baseView({ yKeys: [0], seriesStyles: { 0: { width: 2, line: "dashed" } } }),
    { groupKey: 6 },
  );
}

export function facetFigure(): FigureDocument {
  return makeFigure("facet", baseView(), { facetKey: 7 });
}

export function y2Figure(): FigureDocument {
  return makeFigure(
    "y2",
    baseView({
      yKeys: [0, 8],
      y2Keys: [8],
      y2AxisLabel: "Temperature (K)",
      y2Lim: [270, 310] as [number, number],
      y2Scale: "linear",
      seriesStyles: { 0: { width: 2 }, 8: { width: 1 } },
    }),
  );
}

export function breakFigure(): FigureDocument {
  return makeFigure("break", baseView({ yKeys: [0] }), { axisBreaks: { x: [[2, 3]] } });
}

export function waterfallFigure(): FigureDocument {
  return makeFigure("waterfall", baseView({ waterfall: 0.25 }));
}

/** Annotations + shapes + reference lines + region shade + legend title, plus
 *  the full per-series style vocabulary (colour/width/dash/marker/step/fill). */
export function decorFigure(): FigureDocument {
  const styles: Record<number, SeriesStyle> = {
    0: {
      color: FIXTURE_COLORS[0],
      width: 2,
      line: "dashed",
      marker: true,
      markerShape: "square",
      markerSize: 7,
      fill: "under",
    },
    1: { color: FIXTURE_COLORS[1], width: 1, line: "dotted", step: "post" },
  };
  return makeFigure(
    "decor",
    baseView({
      seriesStyles: styles,
      legendTitle: "Runs",
      legendPos: "se",
      annotations: [
        { id: "ann-1", x: 1, y: 0.5, text: "onset" },
        { id: "ann-2", x: 4, y: 2.5, text: "plateau" },
      ],
      shapes: [
        { id: "shape-1", kind: "arrow", x1: 1, y1: 1, x2: 3, y2: 2 },
        { id: "shape-2", kind: "rect", x1: 2, y1: 0, x2: 4, y2: 1 },
      ],
      refLines: [
        { id: "ref-x", axis: "x", value: 2.5 },
        { id: "ref-y", axis: "y", value: 1.5 },
      ],
      regionShades: [{ id: "shade-1", x1: 0.5, x2: 1.5, y1: 0, y2: 3, fill: "#334455" }],
    }),
  );
}

/** THREE plotted channels with the FIRST one HIDDEN (BUG-015). The canvas keeps
 *  a hidden series in its display list with `show:false`, so channels 1 and 2
 *  sit on palette slots 1 and 2; the export drops hidden channels outright and
 *  the reopened document re-derives the list the same way. Any leg that
 *  renumbered its own filtered list would put the survivors on slots 0 and 1,
 *  which is the bug this fixture exists to keep fixed — three channels rather
 *  than the two-series minimum so a one-slot slide and a "always slot 0" bug
 *  are distinguishable. */
export function hiddenFigure(): FigureDocument {
  return makeFigure(
    "hidden",
    baseView({
      yKeys: [0, 1, 2],
      hiddenChannels: [0],
      seriesStyles: { 0: { width: 2 }, 1: { width: 1 }, 2: { width: 3 } },
    }),
  );
}

export const MATRIX_FIXTURES = [
  "plain",
  "errors",
  "group",
  "facet",
  "y2",
  "break",
  "waterfall",
  "decor",
  "hidden",
] as const;

export type MatrixFixtureName = (typeof MATRIX_FIXTURES)[number];

export function matrixFixture(name: MatrixFixtureName): FigureDocument {
  switch (name) {
    case "plain": return plainFigure();
    case "errors": return errorsFigure();
    case "group": return groupFigure();
    case "facet": return facetFigure();
    case "y2": return y2Figure();
    case "break": return breakFigure();
    case "waterfall": return waterfallFigure();
    case "decor": return decorFigure();
    case "hidden": return hiddenFigure();
  }
}

// ── the multi-panel page fixture ────────────────────────────────────────────

/** Four one-channel figures, distinctly NAMED (the name is the panel identity
 *  every leg carries — see `regressionMatrixPage.testkit.ts`). */
export function pageFigures(): FigureDocument[] {
  return [0, 1, 8, 0].map((ch, i) =>
    createFigureDocument({
      id: `page-fig-${i}`,
      name: `panel ${i}`,
      datasetId: "matrix-ds",
      view: baseView({ yKeys: [ch], seriesStyles: { [ch]: { width: 2 } } }),
      output: { format: "pdf", stylePreset: "default", dpi: 300, transparent: false, filename: null },
    }),
  );
}

/** A 2x2 page with LINKED x and y axes and one explicit per-panel label/title
 *  override, so both the auto-label sequence and an override are exercised. */
export function pageFixture(figures: readonly FigureDocument[]): PageDocument {
  const stamp = "2026-09-14T00:00:00.000Z";
  const page = createPageDocument({
    id: "matrix-page",
    name: "matrix page",
    rows: 2,
    cols: 2,
    createdAt: stamp,
    modifiedAt: stamp,
  });
  return {
    ...page,
    panels: figures.map((figure, i) => ({
      figureId: figure.id,
      label: i === 3 ? "(iv)" : null,
      title: i === 1 ? "custom panel title" : null,
    })),
    layout: { ...page.layout, linkX: true, linkY: true, rowGap: 0.05, colGap: 0.04 },
  };
}
