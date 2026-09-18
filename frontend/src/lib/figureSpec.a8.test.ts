// A8 acceptance journey (FIGURE_AUTHORING_WORKFLOW_PLAN, ~line 1514):
// "Export SVG/PDF and compare limits, ticks, text, legend, errors,
// annotations, and panel placement."
//
// This is the CONTRACT half of that comparison (the backend structural half
// is `tests/test_export_vector_structure.py`, which renders the real
// `/api/export/figure`/`/api/export/figure-hitmap`/`/api/export/figure-page`
// routes and reads the SVG/PDF/JSON they produce). A structural SVG
// assertion can only prove the backend does the RIGHT thing with whatever
// wire payload it received -- it says nothing about whether the FRONTEND
// ever puts the right fields on that payload in the first place. This file
// pins the other half: building a `FigureSpec` from a canonical
// `FigureDocument` that carries explicit x/y limits, a custom tick
// step+format, a rich-text title, a 3-series legend, one series' error
// spans, two annotations, and an arrow shape, and asserting every one of
// those fields survives onto the wire object the backend actually reads
// (see the field-by-field cross-reference in each `it` block below). A
// frontend regression that silently drops one of these fields is caught
// here, before the exported SVG/PDF even changes shape.
//
// The existing `figureSpec.test.ts` suite already pins the general
// PlotView -> FigureSpec adapter byte-for-byte (`richView()`); this file is
// deliberately narrower and named for the acceptance journey it backs,
// scoped to exactly the fields A8's structural SVG test reads back out.

import { describe, expect, it } from "vitest";

import { buildFigureSpecFromDocument } from "./figureSpec";
import { createFigureDocument } from "./figureDocument";
import { defaultPlotView } from "./plotview";
import type { Dataset, DataStruct } from "./types";

// Mirrors tests/test_export_vector_structure.py's fixture: three named
// series (a fourth column holds one series' Y-error magnitude).
const data: DataStruct = {
  time: [0, 1, 2, 3, 4],
  values: [
    [0.0, 1.0, 0.0, 0.15],
    [0.5, 0.9, 0.1, 0.15],
    [1.0, 0.8, 0.2, 0.15],
    [0.5, 0.7, 0.3, 0.15],
    [0.0, 0.6, 0.4, 0.15],
  ],
  labels: ["Series A", "Series B", "Series C", "err"],
  units: ["au", "au", "au", "au"],
  metadata: {},
};

const dataset: Dataset = { id: "a8-dataset", name: "a8.csv", data };

const RICH_TITLE = "Field $\\mu_0 H$ ($\\AA^{-1}$)";
const ANNOTATIONS = [
  { id: "ann1", x: 3, y: 0.5, text: "peak note" },
  { id: "ann2", x: 6, y: -0.5, text: "dip note" },
];
const ARROW_SHAPE = {
  id: "arrow1",
  kind: "arrow" as const,
  x1: 2,
  y1: 1,
  x2: 4,
  y2: 1.2,
};

function a8Document() {
  return createFigureDocument({
    id: "a8-figure",
    name: "A8 fixture",
    datasetId: dataset.id,
    view: {
      ...defaultPlotView(),
      xKey: null,
      yKeys: [0, 1, 2],
      xLim: [1, 9] as [number, number],
      yLim: [-1.5, 1.5] as [number, number],
      xFmt: { mode: "fixed" as const, digits: 1 },
      xStep: 1,
      plotTitle: RICH_TITLE,
      xAxisLabel: "Field",
      yAxisLabel: "Signal",
      showLegend: true,
      annotations: ANNOTATIONS,
      shapes: [ARROW_SHAPE],
    },
    errors: [{ target: 0, channel: 3, axis: "y", side: "both" }],
    output: { format: "svg", stylePreset: "default", dpi: 200, transparent: false, filename: "a8" },
  });
}

describe("A8 wire contract: buildFigureSpecFromDocument carries every field the export routes read", () => {
  const spec = buildFigureSpecFromDocument(a8Document(), dataset, "a8-fallback");

  it("limits: overrides.x_lim/y_lim reach the wire (read by /api/export/figure-hitmap's axes.xlim/ylim)", () => {
    expect(spec.overrides?.x_lim).toEqual([1, 9]);
    expect(spec.overrides?.y_lim).toEqual([-1.5, 1.5]);
  });

  it("ticks: x_step + x_fmt reach the wire (read as the exported SVG's literal tick-label text)", () => {
    expect(spec.x_step).toBe(1);
    expect(spec.x_fmt).toEqual({ mode: "fixed", digits: 1 });
  });

  it("text: the rich-text title and plain axis labels reach the wire verbatim", () => {
    expect(spec.title).toBe(RICH_TITLE);
    expect(spec.x_label).toBe("Field");
    expect(spec.y_label).toBe("Signal");
  });

  it("legend: show=true plus every plotted series' dataset label/unit reach the wire (the exported legend's entries)", () => {
    expect(spec.overrides?.legend?.show).toBe(true);
    expect(typeof spec.overrides?.legend?.loc).toBe("string");
    // The backend derives each legend entry's text from `dataset.labels[ch]`
    // + `dataset.units[ch]` for every channel in `y_keys`, in THAT order --
    // a frontend regression that reorders/drops a plotted channel would
    // silently reorder/drop a legend entry without touching `overrides` at
    // all, so y_keys + the dataset's own labels/units are the real contract.
    expect(spec.y_keys).toEqual([0, 1, 2]);
    const channels = (spec.y_keys ?? []) as number[];
    expect(channels.map((ch) => spec.dataset.labels[ch])).toEqual([
      "Series A",
      "Series B",
      "Series C",
    ]);
    expect(channels.map((ch) => spec.dataset.units[ch])).toEqual(["au", "au", "au"]);
  });

  it("errors: exactly one plotted series carries its y error span, aligned to y_keys' order", () => {
    expect(spec.error_spans).toHaveLength(3);
    expect(spec.error_spans?.[0]).toEqual({ y: { plus: [0.15, 0.15, 0.15, 0.15, 0.15], minus: [0.15, 0.15, 0.15, 0.15, 0.15] } });
    expect(spec.error_spans?.[1]).toBeNull();
    expect(spec.error_spans?.[2]).toBeNull();
  });

  it("annotations: both texts and positions reach the wire (read as standalone exported <text>)", () => {
    expect(spec.overrides?.annotations).toEqual([
      { x: 3, y: 0.5, text: "peak note" },
      { x: 6, y: -0.5, text: "dip note" },
    ]);
  });

  it("shapes: the arrow reaches the wire (read as an exported <g id=\"shape:0\"> group)", () => {
    expect(spec.overrides?.shapes).toEqual([{ kind: "arrow", x1: 2, y1: 1, x2: 4, y2: 1.2 }]);
  });
});
