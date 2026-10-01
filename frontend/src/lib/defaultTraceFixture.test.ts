// The Preferences "Default trace" (Scatter / Line + markers / Step), screen ==
// export, pinned as a SHARED wire fixture
// (`tests/fixtures/wire/default_trace.json`).
//
// The canvas draws each series with no explicit style in the default trace;
// the live Stage export (`figureSpecStage.buildStageFigureSpec` — Export
// figure, Copy figure) used to ignore the preference, so an ambient Scatter
// plot exported as lines. Each case states what every DRAWN series looks like
// (a connecting line? markers? a step?) and the canvas half reads that back
// out of the real `buildOpts` options object; the request half asserts the
// exact request the Stage sends says the same; the backend half
// (`tests/test_export_default_trace.py`) asserts matplotlib draws it.
//
// Regenerate only after a DELIBERATE rule change:
//   DEFAULT_TRACE_FIXTURE_WRITE=1 npx vitest run src/lib/defaultTraceFixture.test.ts

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type uPlot from "uplot";
import { describe, expect, it } from "vitest";

import type { FigureSpec } from "./api/figures";
import type { StoreGet } from "./exportActive";
import { createFigureDocument } from "./figureDocument";
import { buildStageFigureSpec } from "./figureSpecStage";
import { buildColumns, effectiveChannels } from "./plotdata";
import { defaultPlotView, type PlotView } from "./plotview";
import type { Dataset, DefaultTrace } from "./types";
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

interface Drawn {
  line: boolean;
  marker: boolean;
  step: "post" | null;
}

interface Case {
  name: string;
  trace: DefaultTrace;
  view: Partial<PlotView>;
  /** One entry per DRAWN series, in display order. */
  drawn: Drawn[];
}

const LINE: Drawn = { line: true, marker: false, step: null };
const DOTS: Drawn = { line: false, marker: true, step: null };
const BOTH: Drawn = { line: true, marker: true, step: null };
const STEP: Drawn = { line: true, marker: false, step: "post" };

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
];

const STEP_POST = (() => undefined) as unknown as uPlot.Series.PathBuilder;

function viewOf(c: Case): PlotView {
  return { ...defaultPlotView(), ...c.view };
}

/** What the canvas draws per drawn series, read from the real options object. */
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
    return [{
      line: (s.width ?? 1) > 0,
      marker: (s.points as uPlot.Series.Points | undefined)?.show === true,
      step: s.paths === STEP_POST ? "post" as const : null,
    }];
  });
}

/** The request the focused Stage window's Export figure / Copy figure sends. */
function request(c: Case): FigureSpec {
  const view = viewOf(c);
  const document = createFigureDocument({ id: "w1-doc", name: "Trace", datasetId: "d1", view });
  const get = (() => ({
    ...view,
    focusedWindowId: "w1",
    windowsForSave: () => [{ id: "w1", kind: "plot", document }],
    autoSeriesStyles: false,
    defaultTrace: c.trace,
  })) as unknown as StoreGet;
  return buildStageFigureSpec(get, DS, "trace", {
    fmt: "svg", style: "default", dpi: 300, title: "", xLabel: "", yLabel: "",
  });
}

/** What the request asks matplotlib to draw per series. */
function wire(spec: FigureSpec): Drawn[] {
  return (spec.y_keys ?? []).map((_k, i) => {
    const st = spec.series_styles?.[i] ?? null;
    return {
      line: st?.line !== "none" && (st?.width == null || st.width > 0),
      marker: st?.marker === true,
      step: st?.step === "post" ? "post" : null,
    };
  });
}

function fresh() {
  return { cases: CASES.map((c) => ({ name: c.name, trace: c.trace, request: request(c), drawn: c.drawn })) };
}

describe("the default trace, screen == export", () => {
  it.each(CASES)("canvas: $name", (c) => {
    expect(canvas(c)).toEqual(c.drawn);
  });

  it.each(CASES)("request: $name", (c) => {
    expect(wire(request(c))).toEqual(c.drawn);
  });

  it("matches the committed fixture the backend half reads", () => {
    const now = fresh();
    if (process.env.DEFAULT_TRACE_FIXTURE_WRITE) {
      writeFileSync(FIXTURE, `${JSON.stringify(now, null, 2)}\n`, "utf8");
    }
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(JSON.parse(JSON.stringify(now)));
  });
});
