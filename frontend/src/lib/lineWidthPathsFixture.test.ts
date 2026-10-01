// Widthless lines on the three export paths `exportLineWidth` does not build:
// the spatial page, the Graph Builder's encoded export and the polar figure.
// Shared wire fixture: `tests/fixtures/wire/line_width_paths.json`.
//
// Each canvas sizes an unstyled line its own way, and each export sends THAT
// width (px read as pt), never the style preset's `line_width`:
//   - a spatial page cell is a uPlot canvas like the Stage, so it draws at
//     `plotTemplates.canvasLineWidth(template, pref)`;
//   - the Graph Builder preview strokes every series at a fixed
//     `GRAPH_PREVIEW_LINE_PX`, whatever the plot template or the Preferences
//     width, and the encoded export draws the PREVIEW's series;
//   - the polar canvas strokes every series at a fixed `POLAR_LINE_PX` and
//     ignores a series' own width, which the polar request never sends.
// The canvas half reads each width back out of the real renderer (uPlot's
// options; the two Canvas2D painters through a recording context). The request
// half reads the exact request each path sends. The backend half
// (`tests/test_export_line_width_paths.py`) asserts matplotlib draws it.
//
// Regenerate only after a DELIBERATE rule change:
//   LINE_WIDTH_PATHS_FIXTURE_WRITE=1 npx vitest run src/lib/lineWidthPathsFixture.test.ts

import { render } from "@testing-library/react";
import { createElement } from "react";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type uPlot from "uplot";
import { afterEach, describe, expect, it, vi } from "vitest";

import PolarStageCore from "../components/Stage/PolarStageCore";
import { drawXY } from "../components/workshops/graphbuilder/previewCanvas";
import type { FigurePageSpec } from "./api";
import type { FigureSpec } from "./api/figures";
import { buildStageFigureSpec } from "./figureSpecStage";
import { spatialCellStyling, type SpatialPanel } from "./multipanel";
import { buildColumns } from "./plotdata";
import { encodeSpec } from "./plotEncoding";
import { buildEncodedExport } from "./plotEncodingExport";
import type { PlotSpec } from "./plotspec";
import { canvasLineWidth } from "./plotTemplates";
import { defaultPageSetup } from "./pagesetup";
import type { ExportSeriesStyle } from "./publicationStyles";
import { buildSpatialPageRequest } from "./spatialPageExport";
import type { Dataset, DefaultTrace, SeriesStyle } from "./types";
import { buildOpts } from "./uplotOpts";
import { useApp } from "../store/useApp";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "tests", "fixtures", "wire", "line_width_paths.json",
);

/** One drawn series: a connecting line, and how wide (null without a line). */
interface Drawn {
  line: boolean;
  width: number | null;
}
const at = (width: number): Drawn => ({ line: true, width });
const NO_LINE: Drawn = { line: false, width: null };

const DS: Dataset = {
  id: "d1",
  name: "widths.csv",
  data: {
    time: [0, 1, 2, 3],
    values: [[1, 5, 0], [2, 6, 1], [3, 7, 0], [4, 8, 1]],
    labels: ["A", "B", "G"],
    units: ["au", "au", ""],
    metadata: {},
    cat_levels: { 2: ["p", "q"] },
  },
};

interface SpatialCase {
  kind: "spatial";
  name: string;
  template: string;
  pref: number;
  trace: DefaultTrace;
  style: string;
  panels: { yKeys: number[]; seriesStyles?: Record<number, SeriesStyle> }[];
  drawn: Drawn[];
}
interface GraphCase {
  kind: "graph";
  name: string;
  /** Set on the live store, to show the Stage's width does NOT apply. */
  template: string;
  style: string;
  spec: PlotSpec;
  drawn: Drawn[];
}
interface PolarCase {
  kind: "polar";
  name: string;
  template: string;
  style: string;
  seriesStyles: Record<number, SeriesStyle>;
  drawn: Drawn[];
}
type Case = SpatialCase | GraphCase | PolarCase;

const ZONES = { x: null, group: null, facet: null, yErr: [], xErr: null };
const ref = (channel: number) => ({ datasetId: "d1", channel });

const CASES: Case[] = [
  {
    kind: "spatial",
    name: "Spatial page: a non-Screen template's width in every panel; an explicit width wins",
    template: "presentation",
    pref: 1.5,
    trace: "Line",
    style: "default",
    panels: [{ yKeys: [0, 1], seriesStyles: { 1: { width: 0.75 } } }, { yKeys: [0] }],
    drawn: [at(2.5), at(0.75), at(2.5)],
  },
  {
    kind: "spatial",
    name: "Spatial page: the Screen template follows the Preferences default line width",
    template: "screen",
    pref: 2,
    trace: "Line",
    style: "poster",
    panels: [{ yKeys: [0, 1] }],
    drawn: [at(2), at(2)],
  },
  {
    kind: "spatial",
    name: "Spatial page: a Scatter default trace still draws no line",
    template: "nature",
    pref: 1.5,
    trace: "Scatter",
    style: "default",
    panels: [{ yKeys: [0] }],
    drawn: [NO_LINE],
  },
  {
    kind: "graph",
    name: "Graph Builder Line mark, Color-by: the preview's fixed width on every level",
    template: "poster",
    style: "poster",
    spec: { version: 1, zones: { ...ZONES, y: [ref(0)], color: ref(2) }, mark: "line" },
    drawn: [at(1.5), at(1.5)],
  },
  {
    kind: "graph",
    name: "Graph Builder Step mark, legend-source label: the preview's fixed width",
    template: "aps",
    style: "default",
    spec: { version: 1, zones: { ...ZONES, y: [ref(0), ref(1)], label: ref(2) }, mark: "step" },
    drawn: [at(1.5), at(1.5)],
  },
  {
    kind: "graph",
    name: "Graph Builder Scatter mark: no line",
    template: "screen",
    style: "default",
    spec: { version: 1, zones: { ...ZONES, y: [ref(0)], color: ref(2) }, mark: "scatter" },
    drawn: [NO_LINE, NO_LINE],
  },
  {
    kind: "polar",
    name: "Polar: every series at the canvas' fixed width, its own width ignored",
    template: "presentation",
    style: "poster",
    seriesStyles: { 1: { width: 4, color: "#d62728" } },
    drawn: [at(1.5), at(1.5)],
  },
];

// ── the canvases ────────────────────────────────────────────────────────────

/** A 2-D context that records the line width of every `stroke()`. */
function recordingCanvas(): { strokes: number[]; restore: () => void } {
  const strokes: number[] = [];
  const state: Record<string | symbol, unknown> = { lineWidth: 1 };
  const ctx = new Proxy(state, {
    get: (t, k) => (k in t ? t[k] : k === "stroke" ? () => strokes.push(t.lineWidth as number) : () => undefined),
    set: (t, k, v) => {
      t[k] = v;
      return true;
    },
  });
  const spy = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as never);
  return { strokes, restore: () => spy.mockRestore() };
}

function spatialPanels(c: SpatialCase): SpatialPanel[] {
  return c.panels.map((p, i) => ({
    datasetId: "d1", xKey: null, yKeys: p.yKeys, seriesStyles: p.seriesStyles,
    xLim: [0, 3], yLim: [0, 9], xLog: false, yLog: false, row: 0, col: i,
    pageRect: { left: 0.05 + 0.5 * i, top: 0.1, width: 0.4, height: 0.8 },
  }));
}

const STEP_POST = (() => undefined) as unknown as uPlot.Series.PathBuilder;

/** What each spatial cell's uPlot canvas draws: `useMultiPanelStage`'s per-cell
 *  `buildOpts`, at the width `MultiPanelStage` hands it. */
function spatialCanvas(c: SpatialCase): Drawn[] {
  return spatialPanels(c).flatMap((panel) => {
    const { plottedChannels, cellStyles } = spatialCellStyling(panel, false);
    const opts = buildOpts(buildColumns(DS.data, null, null, plottedChannels), {
      width: 300, height: 200, xScale: "linear", yScale: "linear", tool: "cursor", onReadout: () => {},
      seriesStyles: cellStyles, plotted: plottedChannels, defaultTrace: c.trace, steppedPaths: STEP_POST,
      baseLineWidth: canvasLineWidth(c.template, c.pref),
    });
    return plottedChannels.map((_ch, i) => {
      const w = opts.series[i + 1].width ?? 1;
      return w > 0 ? at(w) : NO_LINE;
    });
  });
}

/** What the Graph Builder preview strokes per series (`GraphPreview`'s xy call). */
function graphCanvas(c: GraphCase): Drawn[] {
  const e = encodeSpec(c.spec, [DS])!;
  const rec = recordingCanvas();
  try {
    const mark = c.spec.mark as "scatter" | "line" | "step";
    drawXY(document.createElement("canvas"), document.createElement("div"), e.payload, mark, false, "post", undefined, e.styles);
  } finally {
    rec.restore();
  }
  // A line/step series is one stroke after the frame; a scatter strokes none.
  return c.spec.mark === "scatter" ? e.styles.map(() => NO_LINE) : rec.strokes.map(at);
}

/** What the polar canvas strokes per series: the last stroke per channel
 *  (rings, the rim and spokes come first). */
function polarCanvas(c: PolarCase): Drawn[] {
  const rec = recordingCanvas();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  try {
    render(createElement(PolarStageCore, {
      dataset: DS, yKeys: [0, 1], seriesStyles: c.seriesStyles, showGrid: true, theme: "dark", accent: "violet",
    } as never));
  } finally {
    rec.restore();
    vi.unstubAllGlobals();
  }
  return rec.strokes.slice(-2).map(at);
}

function canvas(c: Case): Drawn[] {
  return c.kind === "spatial" ? spatialCanvas(c) : c.kind === "graph" ? graphCanvas(c) : polarCanvas(c);
}

// ── the requests ────────────────────────────────────────────────────────────

const OPTS = { fmt: "svg", dpi: 100, title: "", xLabel: "", yLabel: "" };

function request(c: Case): { route: "figure" | "figure-page"; body: FigureSpec | FigurePageSpec } {
  if (c.kind === "spatial") {
    const body = buildSpatialPageRequest(spatialPanels(c), new Map([["d1", DS.data]]), defaultPageSetup(), {
      xFmt: { mode: "auto", digits: 2 }, yFmt: { mode: "auto", digits: 2 }, showGrid: false, showAxisBox: true,
      defaultTrace: c.trace, lineWidth: canvasLineWidth(c.template, c.pref),
    });
    return { route: "figure-page", body: { ...body!, fmt: "svg", style: c.style } }; // the preset is page-wide
  }
  if (c.kind === "graph") {
    // The Export button's own builder, over a Stage whose template width differs.
    useApp.setState({
      datasets: [DS], activeId: "d1", polarMode: false, xKey: null, yKeys: null, seriesStyles: {},
      plotTemplate: c.template, defaultLineWidth: 2.25,
    });
    return { route: "figure", body: buildEncodedExport(useApp.getState, c.spec, DS, "widths", { ...OPTS, style: c.style }) };
  }
  useApp.setState({
    datasets: [DS], activeId: "d1", polarMode: true, xKey: null, yKeys: [0, 1], seriesStyles: c.seriesStyles,
    seriesLabels: {}, showGrid: true, pageSetup: null, plotTemplate: c.template,
  });
  try {
    return { route: "figure", body: buildStageFigureSpec(useApp.getState, DS, "widths", { ...OPTS, style: c.style }) };
  } finally {
    useApp.setState({ polarMode: false });
  }
}

function drawnOf(st: ExportSeriesStyle | null | undefined): Drawn {
  const line = st?.line !== "none" && (st?.width == null || st.width > 0);
  return { line, width: line ? (st?.width ?? null) : null };
}

/** What the request asks matplotlib to draw per series: page panels in turn;
 *  a Color-by split once per level of the colour column. */
function wire(c: Case): Drawn[] {
  const { body } = request(c);
  if ("panels" in body) return body.panels.flatMap((p) => (p.figure.y_keys ?? []).map((_k, i) => drawnOf(p.figure.series_styles?.[i])));
  const col = body.encoding?.color_col;
  const levels = col == null ? 1 : new Set(body.dataset.values.map((row) => row[col])).size;
  return (body.y_keys ?? []).flatMap((_k, i) => Array.from({ length: levels }, () => drawnOf(body.series_styles?.[i])));
}

function fresh() {
  return {
    rule:
      "A line with no explicit width exports at the width its canvas draws it (px sent as pt), never the style "
      + "preset's line_width: a spatial page cell at the plot template's width (the Preferences default under "
      + "Screen), the Graph Builder's encoded export at its preview's fixed 1.5 px, the polar figure at the polar "
      + "canvas' fixed 1.5 px.",
    cases: CASES.map((c) => ({ name: c.name, ...request(c), drawn: c.drawn })),
  };
}

describe("widthless lines on the spatial, Graph Builder and polar exports, screen == export", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(CASES)("canvas: $name", (c) => {
    expect(canvas(c)).toEqual(c.drawn);
  });

  it.each(CASES)("request: $name", (c) => {
    expect(wire(c)).toEqual(c.drawn);
  });

  it("matches the committed fixture the backend half reads", () => {
    const now = fresh();
    if (process.env.LINE_WIDTH_PATHS_FIXTURE_WRITE) {
      writeFileSync(FIXTURE, `${JSON.stringify(now, null, 2)}\n`, "utf8");
    }
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(JSON.parse(JSON.stringify(now)));
  });
});
