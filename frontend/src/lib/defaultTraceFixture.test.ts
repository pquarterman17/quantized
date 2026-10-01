// The Preferences "Default trace" (Scatter / Line + markers / Step), screen ==
// export, pinned as a SHARED wire fixture
// (`tests/fixtures/wire/default_trace.json`).
//
// The canvas draws each series with no explicit style in the default trace;
// every export used to ignore the preference, so an ambient Scatter plot
// exported as lines, and a default-trace marker came out at the style
// preset's size instead of the canvas' 5 px -- as did any marker with no
// explicit size, under every trace (`exportStyles.toWireSeriesStyles` rule 3
// now names it; see `marker_size_rule` in the fixture). A line with no explicit
// width likewise came out at the preset's `line_width` instead of the plot
// template's (`exportLineWidth`; `line_width_rule`). Each case states what every
// DRAWN series looks like (a connecting line, how wide? markers, at what size? a step?)
// and the canvas half reads that back out of the real `buildOpts` options
// object; the request half asserts the exact request the Stage sends says the
// same (a flat, facet or encoded request); the backend half
// (`tests/test_export_default_trace.py`) asserts matplotlib draws it. The
// other export builders -- a saved document, a page panel or report figure
// (`buildFigureSpecFromDocument`), the Figure Builder's preview / Export and
// its live-plot mirror -- must send what the Stage sends.
//
// Regenerate only after a DELIBERATE rule change:
//   DEFAULT_TRACE_FIXTURE_WRITE=1 npx vitest run src/lib/defaultTraceFixture.test.ts

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type uPlot from "uplot";
import { describe, expect, it } from "vitest";

import { computeCanonicalReadiness } from "../components/workshops/figurebuilder/canonicalReadiness";
import { buildLegacyFigureSpec } from "../components/workshops/figurebuilder/legacyFigure";
import type { FigureSpec } from "./api/figures";
import type { StoreGet } from "./exportActive";
import { withDefaultTrace } from "./exportDefaultTrace";
import {
  createFigureDocument,
  deserializeFigureDocument,
  serializeFigureDocument,
  type FigureDocument,
} from "./figureDocument";
import type { FigureEncoding } from "./figureEncoding";
import { buildFigureSpecFromDocument } from "./figureSpec";
import { buildStageFigureSpec } from "./figureSpecStage";
import { buildColumns, effectiveChannels } from "./plotdata";
import { markSeriesStyle, type PlotMark } from "./plotspec";
import { defaultPlotView, sanitizePlotView, type PlotView } from "./plotview";
import type { ExportSeriesStyle } from "./publicationStyles";
import type { Dataset, DefaultTrace, SeriesStyle } from "./types";
import { canvasLineWidth } from "./plotTemplates";
import { buildOpts } from "./uplotOpts";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "tests", "fixtures", "wire", "default_trace.json",
);

const DS: Dataset = {
  id: "d1",
  name: "trace.csv",
  data: {
    time: [0, 1, 2, 3],
    values: [[1, 5, 9], [2, 6, 8], [3, 7, 7], [4, 8, 6]],
    labels: ["A", "B", "C"],
    units: ["au", "au", "au"],
    metadata: {},
  },
};

/** Rows 0/2 are level "p", rows 1/3 level "q" of the factor G. */
const DS_SPLIT: Dataset = {
  id: "d1",
  name: "split.csv",
  data: {
    time: [0, 1, 2, 3],
    values: [[1, 5, 0], [2, 6, 1], [3, 7, 0], [4, 8, 1]],
    labels: ["A", "B", "G"],
    units: ["au", "au", ""],
    metadata: {},
    cat_levels: { 2: ["p", "q"] },
  },
};

interface Drawn {
  line: boolean;
  marker: boolean;
  /** Marker size (CSS px on the canvas, points on paper); null without one. */
  size: number | null;
  step: "post" | null;
  /** Line width (CSS px on the canvas, points on paper); null without a line. */
  width: number | null;
}

interface Case {
  name: string;
  trace: DefaultTrace;
  view: Partial<PlotView>;
  /** The export's style preset (default: "default"). */
  style?: string;
  /** Preferences "Default line width" (default: the pref's own 1.5). */
  lineWidthPref?: number;
  /** A split request: a facet grid (`facetKey`) or a Color-by encoding. */
  split?: { facetKey?: number; encoding?: FigureEncoding };
  /** One entry per DRAWN series, in display order (facet panels in turn). */
  drawn: Drawn[];
}

const LINE: Drawn = { line: true, marker: false, size: null, step: null, width: 1.5 };
const DOTS: Drawn = { line: false, marker: true, size: 5, step: null, width: null };
const BOTH: Drawn = { line: true, marker: true, size: 5, step: null, width: 1.5 };
const STEP: Drawn = { line: true, marker: false, size: null, step: "post", width: 1.5 };

/** The style a Graph Builder mark commits to a fresh series (`markSeriesStyle`). */
function mark(m: PlotMark, showMarkers?: boolean): SeriesStyle {
  return markSeriesStyle({
    version: 1, mark: m, showMarkers, zones: { x: null, y: [], group: null, facet: null, yErr: [], xErr: null },
  });
}

const CASES: Case[] = [
  { name: "Line: plain lines", trace: "Line", view: { yKeys: [0, 1] }, drawn: [LINE, LINE] },
  { name: "Scatter: markers, no line", trace: "Scatter", view: { yKeys: [0, 1] }, drawn: [DOTS, DOTS] },
  {
    name: "Scatter: an explicit width keeps its line",
    trace: "Scatter",
    view: { yKeys: [0, 1], seriesStyles: { 1: { width: 2 } } },
    drawn: [DOTS, { ...BOTH, width: 2 }],
  },
  { name: "Line + markers", trace: "Line + markers", view: { yKeys: [0, 1] }, drawn: [BOTH, BOTH] },
  {
    name: "Step: an explicit line style is not stepped",
    trace: "Step",
    view: { yKeys: [0, 1], seriesStyles: { 1: { line: "dashed" } } },
    drawn: [STEP, LINE],
  },
  {
    name: "Scatter with a hidden series",
    trace: "Scatter",
    view: { yKeys: [0, 1, 2], hiddenChannels: [1] },
    drawn: [DOTS, DOTS],
  },
  {
    name: "Scatter on a preset with smaller markers: the canvas' 5 px",
    trace: "Scatter",
    view: { yKeys: [0] },
    style: "aps",
    drawn: [DOTS],
  },
  {
    name: "Facet grid: Line + markers in every panel",
    trace: "Line + markers",
    view: { yKeys: [0, 1] },
    split: { facetKey: 2 },
    drawn: [BOTH, BOTH, BOTH, BOTH],
  },
  {
    name: "Scatter: a Graph Builder Line mark keeps its line, no markers",
    trace: "Scatter",
    view: { yKeys: [0, 1], seriesStyles: { 0: mark("line") } },
    drawn: [LINE, DOTS],
  },
  {
    name: "Scatter: a Graph Builder Step mark is a stepped line, no markers",
    trace: "Scatter",
    view: { yKeys: [0, 1], seriesStyles: { 0: mark("step") } },
    drawn: [STEP, DOTS],
  },
  {
    name: "Line + markers: a Graph Builder Line mark draws no markers",
    trace: "Line + markers",
    view: { yKeys: [0, 1], seriesStyles: { 0: mark("line") } },
    drawn: [LINE, BOTH],
  },
  {
    name: "Step: a Graph Builder Line mark is not stepped",
    trace: "Step",
    view: { yKeys: [0, 1], seriesStyles: { 0: mark("line") } },
    drawn: [LINE, STEP],
  },
  {
    name: "Facet grid: Graph Builder Line marks under Scatter",
    trace: "Scatter",
    view: { yKeys: [0, 1], seriesStyles: { 0: mark("line"), 1: mark("line") } },
    split: { facetKey: 2 },
    drawn: [LINE, LINE, LINE, LINE],
  },
  {
    name: "Color-by encoding: Scatter on every level",
    trace: "Scatter",
    view: { yKeys: [0] },
    split: { encoding: { color: 2 } },
    drawn: [DOTS, DOTS],
  },
  // A marker with no `markerSize` (the Inspector's Markers box, its Scatter
  // trace, a Graph Builder mark with markers) draws at the canvas' 5 px on any
  // preset, so it exports at 5 pt too (`fresh().marker_size_rule`).
  {
    name: "Line: a sizeless Inspector marker is the canvas' 5 px on a smaller-marker preset",
    trace: "Line",
    view: { yKeys: [0, 1], seriesStyles: { 0: { marker: true }, 1: { width: 0, marker: true } } },
    style: "aps",
    drawn: [BOTH, DOTS],
  },
  {
    name: "Line: an explicit marker size wins",
    trace: "Line",
    view: { yKeys: [0], seriesStyles: { 0: { marker: true, markerSize: 9 } } },
    style: "aps",
    drawn: [{ ...BOTH, size: 9 }],
  },
  {
    name: "Line: Graph Builder Line + markers and Scatter marks are the canvas' 5 px",
    trace: "Line",
    view: { yKeys: [0, 1], seriesStyles: { 0: mark("line", true), 1: mark("scatter") } },
    style: "poster",
    drawn: [BOTH, DOTS],
  },
  {
    name: "Facet grid: a sizeless Inspector marker in every panel",
    trace: "Line",
    view: { yKeys: [0, 1], seriesStyles: { 0: { marker: true } } },
    style: "aps",
    split: { facetKey: 2 },
    drawn: [BOTH, LINE, BOTH, LINE],
  },
  {
    name: "Color-by encoding: a sizeless Inspector marker on every level",
    trace: "Line",
    view: { yKeys: [0], seriesStyles: { 0: { marker: true } } },
    style: "aps",
    split: { encoding: { color: 2 } },
    drawn: [BOTH, BOTH],
  },
  // A line with no explicit width draws at the plot template's width (or, under
  // the Screen template, the Preferences default), so it exports at that many
  // points, not the style preset's `line_width` (`fresh().line_width_rule`).
  {
    name: "Line: an unstyled line is the Screen template's 1.5 px, not the preset's 1.2 pt",
    trace: "Line",
    view: { yKeys: [0] },
    drawn: [LINE],
  },
  {
    name: "Line: the Screen template follows the Preferences default line width",
    trace: "Line",
    view: { yKeys: [0, 1] },
    style: "aps",
    lineWidthPref: 2.5,
    drawn: [{ ...LINE, width: 2.5 }, { ...LINE, width: 2.5 }],
  },
  {
    name: "Line: a non-Screen plot template's width, on a different preset",
    trace: "Line",
    view: { yKeys: [0, 1], plotTemplate: "aps" },
    style: "poster",
    lineWidthPref: 2.5,
    drawn: [{ ...LINE, width: 1 }, { ...LINE, width: 1 }],
  },
  {
    name: "Line: an explicit width wins over the template",
    trace: "Line",
    view: { yKeys: [0, 1], plotTemplate: "nature", seriesStyles: { 1: { width: 3 } } },
    drawn: [{ ...LINE, width: 1.2 }, { ...LINE, width: 3 }],
  },
  {
    name: "Facet grid: the template width in every panel",
    trace: "Line",
    view: { yKeys: [0, 1], plotTemplate: "presentation" },
    split: { facetKey: 2 },
    drawn: Array.from({ length: 4 }, () => ({ ...LINE, width: 2.5 })),
  },
  {
    name: "Color-by encoding: the template width on every level",
    trace: "Line",
    view: { yKeys: [0], plotTemplate: "report" },
    split: { encoding: { color: 2 } },
    drawn: [{ ...LINE, width: 1.75 }, { ...LINE, width: 1.75 }],
  },
];

const STEP_POST = (() => undefined) as unknown as uPlot.Series.PathBuilder;

function viewOf(c: Case): PlotView {
  return { ...defaultPlotView(), ...c.view };
}

function datasetOf(c: Case): Dataset {
  return c.split ? DS_SPLIT : DS;
}

/** What the canvas draws per drawn series, read from the real options object
 *  (the flat plot; a facet or encoded canvas runs the same `buildOpts`). */
function canvas(c: Case): Drawn[] {
  const view = viewOf(c);
  const channels = effectiveChannels(DS.data, view.yKeys, view.xKey, undefined, view.seriesOrder);
  const payload = buildColumns(DS.data, null, view.xKey, channels);
  const hidden = channels.map((ch) => view.hiddenChannels.includes(ch));
  const opts = buildOpts(payload, {
    width: 600, height: 400, xScale: "linear", yScale: "linear", tool: "cursor", onReadout: () => {},
    seriesStyles: channels.map((ch) => view.seriesStyles[ch]),
    hidden, plotted: channels, defaultTrace: c.trace, steppedPaths: STEP_POST,
    baseLineWidth: canvasLineWidth(view.plotTemplate, c.lineWidthPref),
  });
  return channels.flatMap((_ch, i) => {
    const s = opts.series[i + 1];
    if (hidden[i]) return [];
    const points = s.points as uPlot.Series.Points | undefined;
    return [{
      line: (s.width ?? 1) > 0,
      marker: points?.show === true,
      size: points?.show === true ? (points.size ?? null) : null,
      step: s.paths === STEP_POST ? "post" as const : null,
      width: (s.width ?? 1) > 0 ? (s.width ?? null) : null,
    }];
  });
}

function documentOf(c: Case): FigureDocument {
  return createFigureDocument({
    id: "w1-doc", name: "Trace", datasetId: "d1", view: viewOf(c),
    facetKey: c.split?.facetKey ?? null, encoding: c.split?.encoding,
  });
}

/** The request the focused Stage window's Export figure / Copy figure sends. */
function request(c: Case): FigureSpec {
  const view = { ...viewOf(c), facetKey: c.split?.facetKey ?? null };
  const document = documentOf(c);
  const get = (() => ({
    ...view,
    focusedWindowId: "w1",
    windowsForSave: () => [{ id: "w1", kind: "plot", document }],
    autoSeriesStyles: false,
    defaultTrace: c.trace,
    defaultLineWidth: c.lineWidthPref,
  })) as unknown as StoreGet;
  return buildStageFigureSpec(get, datasetOf(c), "trace", {
    fmt: "svg", style: c.style ?? "default", dpi: 300, title: "", xLabel: "", yLabel: "",
  });
}

/** What one wire style asks matplotlib to draw (size null = the preset's). */
function drawnOf(st: ExportSeriesStyle | null | undefined): Drawn {
  const line = st?.line !== "none" && (st?.width == null || st.width > 0);
  return {
    line,
    marker: st?.marker === true,
    size: st?.marker === true ? (st.marker_size ?? null) : null,
    step: st?.step === "post" ? "post" : null,
    width: line ? (st?.width ?? null) : null,
  };
}

/** What the request asks matplotlib to draw per drawn series: each facet
 *  panel's series in turn, or each `y_keys` entry once per level of an
 *  encoded split (the backend expands it channel-major). */
function wire(spec: FigureSpec): Drawn[] {
  if (spec.facets) return spec.facets.flatMap((p) => p.series.map((s) => drawnOf(s.style)));
  const col = spec.encoding?.color_col;
  const levels = col == null ? 1 : new Set(spec.dataset.values.map((row) => row[col])).size;
  return (spec.y_keys ?? []).flatMap((_k, i) => Array.from({ length: levels }, () => drawnOf(spec.series_styles?.[i])));
}

/** Every OTHER export builder's request for `c`, under the same trace. */
function otherBuilders(c: Case): [string, FigureSpec | null][] {
  const ds = datasetOf(c);
  const doc = documentOf(c);
  const ready = computeCanonicalReadiness(doc, ds, false, "hide", c.trace, c.lineWidthPref);
  const builders: [string, FigureSpec | null][] = [
    // A saved document, a page panel, a report figure, the Figure Builder's Export.
    ["document", buildFigureSpecFromDocument(doc, ds, "trace", {
      style: c.style, defaultTrace: c.trace, defaultLineWidth: c.lineWidthPref,
    })],
    ["Figure Builder preview", ready?.state === "ready" ? ready.spec : null],
  ];
  // The Figure Builder's live-plot mirror: it plots every PICKED channel (no
  // hidden filter, no facet / encoding), so it is compared where those agree.
  if (!c.split && !c.view.hiddenChannels) {
    const view = viewOf(c);
    builders.push(["Figure Builder live plot", buildLegacyFigureSpec({
      data: ds.data, xKey: null, yKeys: view.yKeys, xScale: "linear", yScale: "linear",
      xFmt: view.xFmt, yFmt: view.yFmt, style: c.style ?? "default", overrides: {}, title: "", xLabel: "", yLabel: "",
      seriesStyles: view.seriesStyles, docSeriesStyles: undefined, docGroupCol: null, y2: null, defaultTrace: c.trace,
      plotTemplate: view.plotTemplate, defaultLineWidth: c.lineWidthPref,
    })]);
  }
  return builders;
}

function fresh() {
  return {
    marker_size_rule:
      "A marker with no explicit size exports at the canvas' DEFAULT_MARKER_PX (5 px, sent as 5 pt), never the "
      + "style preset's marker_size, the px-as-points rule an explicit width or marker size already follows. "
      + "The preset value stays the backend default only for a request that names no size (an API or CLI caller).",
    line_width_rule:
      "A line with no explicit width exports at the width the canvas draws it (the plot template's lineWidth, or "
      + "the Preferences default line width under the Screen template; px sent as pt), never the style preset's "
      + "line_width. The preset value stays the backend default only for a request that names no width (an API "
      + "or CLI caller).",
    cases: CASES.map((c) => ({ name: c.name, trace: c.trace, request: request(c), drawn: c.drawn })),
  };
}

describe("the default trace, screen == export", () => {
  it.each(CASES.filter((c) => !c.split))("canvas: $name", (c) => {
    expect(canvas(c)).toEqual(c.drawn);
  });

  it.each(CASES)("request: $name", (c) => {
    expect(wire(request(c))).toEqual(c.drawn);
  });

  it.each(CASES)("every other export builder: $name", (c) => {
    for (const [builder, spec] of otherBuilders(c)) {
      expect(spec, builder).not.toBeNull();
      expect(wire(spec as FigureSpec), builder).toEqual(c.drawn);
    }
  });

  // `SeriesStyle.explicit` (a Graph Builder mark) survives a saved document and
  // a `.dwk` view, so a reopened figure draws and exports the mark, not the trace.
  it.each(CASES.filter((c) => c.name.includes("Graph Builder")))("save/reopen: $name", (c) => {
    const doc = deserializeFigureDocument(serializeFigureDocument(documentOf(c)));
    expect(doc).not.toBeNull();
    const spec = buildFigureSpecFromDocument(doc!, datasetOf(c), "trace", {
      style: c.style, defaultTrace: c.trace, defaultLineWidth: c.lineWidthPref,
    });
    expect(wire(spec)).toEqual(c.drawn);
    const view = sanitizePlotView(JSON.parse(JSON.stringify(viewOf(c))));
    expect(view.seriesStyles).toEqual(viewOf(c).seriesStyles);
  });

  it("leaves a gradient encoding alone: its series are colour-mapped scatters on both sides", () => {
    const spec = { ...request(CASES[0]), encoding: { gradient_col: 2 } };
    expect(withDefaultTrace(spec, "Scatter", {})).toBe(spec);
  });

  it("matches the committed fixture the backend half reads", () => {
    const now = fresh();
    if (process.env.DEFAULT_TRACE_FIXTURE_WRITE) {
      writeFileSync(FIXTURE, `${JSON.stringify(now, null, 2)}\n`, "utf8");
    }
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(JSON.parse(JSON.stringify(now)));
  });
});
