// The Preferences "Default trace" (Scatter / Line + markers / Step), screen ==
// export, pinned as a SHARED wire fixture
// (`tests/fixtures/wire/default_trace.json`).
//
// The canvas draws each series with no explicit style in the default trace;
// every export used to ignore the preference, so an ambient Scatter plot
// exported as lines, and a default-trace marker came out at the style
// preset's size instead of the canvas' 5 px. Each case states what every
// DRAWN series looks like (a connecting line? markers, at what size? a step?)
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
}

interface Case {
  name: string;
  trace: DefaultTrace;
  view: Partial<PlotView>;
  /** The export's style preset (default: "default"). */
  style?: string;
  /** A split request: a facet grid (`facetKey`) or a Color-by encoding. */
  split?: { facetKey?: number; encoding?: FigureEncoding };
  /** One entry per DRAWN series, in display order (facet panels in turn). */
  drawn: Drawn[];
}

const LINE: Drawn = { line: true, marker: false, size: null, step: null };
const DOTS: Drawn = { line: false, marker: true, size: 5, step: null };
const BOTH: Drawn = { line: true, marker: true, size: 5, step: null };
const STEP: Drawn = { line: true, marker: false, size: null, step: "post" };

/** The style a Graph Builder mark commits to a fresh series (`markSeriesStyle`). */
function mark(m: PlotMark): SeriesStyle {
  return markSeriesStyle({ version: 1, mark: m, zones: { x: null, y: [], group: null, facet: null, yErr: [], xErr: null } });
}

const CASES: Case[] = [
  { name: "Line: plain lines", trace: "Line", view: { yKeys: [0, 1] }, drawn: [LINE, LINE] },
  { name: "Scatter: markers, no line", trace: "Scatter", view: { yKeys: [0, 1] }, drawn: [DOTS, DOTS] },
  {
    name: "Scatter: an explicit width keeps its line",
    trace: "Scatter",
    view: { yKeys: [0, 1], seriesStyles: { 1: { width: 2 } } },
    drawn: [DOTS, BOTH],
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
  })) as unknown as StoreGet;
  return buildStageFigureSpec(get, datasetOf(c), "trace", {
    fmt: "svg", style: c.style ?? "default", dpi: 300, title: "", xLabel: "", yLabel: "",
  });
}

/** What one wire style asks matplotlib to draw (size null = the preset's). */
function drawnOf(st: ExportSeriesStyle | null | undefined): Drawn {
  return {
    line: st?.line !== "none" && (st?.width == null || st.width > 0),
    marker: st?.marker === true,
    size: st?.marker === true ? (st.marker_size ?? null) : null,
    step: st?.step === "post" ? "post" : null,
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
  const ready = computeCanonicalReadiness(doc, ds, false, "hide", c.trace);
  const builders: [string, FigureSpec | null][] = [
    // A saved document, a page panel, a report figure, the Figure Builder's Export.
    ["document", buildFigureSpecFromDocument(doc, ds, "trace", { style: c.style, defaultTrace: c.trace })],
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
    })]);
  }
  return builders;
}

function fresh() {
  return {
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
    const spec = buildFigureSpecFromDocument(doc!, datasetOf(c), "trace", { style: c.style, defaultTrace: c.trace });
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
