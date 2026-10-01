// The axis titles' right-click Format (size / bold / italic) and dragged
// offsets, screen == export, pinned as a SHARED wire fixture
// (`tests/fixtures/wire/axis_titles.json`).
//
// The canvas draws each title with its Format at its dragged offset
// (`uplotRichLabels.richLabelsPlugin`); the export request used to carry
// neither, so a resized, bolded or moved title exported as the preset's plain
// one. Each case states what every axis title looks like (size in CSS px, null
// = the template's; bold; italic; offset [dx, dy] in CSS px, y DOWN): the
// canvas half reads that back out of the plugin `buildOpts` registers, drawn
// against a stub uPlot; the request half asserts the exact request the Stage
// sends says the same; the backend half (`tests/test_export_axis_titles.py`)
// asserts matplotlib draws it, px read as points.
//
// An x-axis BREAK view draws plain titles: its panels build without the
// Format/drag bridge (`Stage/breakPanelRender`), so the break renderer skips
// the fields (`calc/figure_break.py`). Its canvas half is
// `Stage/MultiPanelStage.breakTitles.test.tsx`; its request half pins that the
// request takes that path (`x_breaks`).
//
// Regenerate only after a DELIBERATE rule change:
//   AXIS_TITLES_FIXTURE_WRITE=1 npx vitest run src/lib/axisTitlesFixture.test.ts

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type uPlot from "uplot";
import { describe, expect, it, vi } from "vitest";

import type { FigureSpec } from "./api/figures";
import type { StoreGet } from "./exportActive";
import { createFigureDocument } from "./figureDocument";
import { buildStageFigureSpec } from "./figureSpecStage";
import { buildColumns, effectiveChannels } from "./plotdata";
import { defaultPlotView, type PlotView } from "./plotview";
import type { AxisKey, Dataset } from "./types";
import { buildOpts } from "./uplotOpts";
import type * as RichLabels from "./uplotRichLabels";

// Capture every richLabelsPlugin `buildOpts` registers, with its arguments, so
// the canvas half draws the REAL plugin the Stage would.
const made: { args: Parameters<typeof RichLabels.richLabelsPlugin>; real: typeof RichLabels.richLabelsPlugin }[] = [];
vi.mock("./uplotRichLabels", async (importOriginal) => {
  const mod = await importOriginal<typeof RichLabels>();
  return {
    ...mod,
    richLabelsPlugin: (...args: Parameters<typeof mod.richLabelsPlugin>) => {
      made.push({ args, real: mod.richLabelsPlugin });
      return mod.richLabelsPlugin(...args);
    },
  };
});

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "tests", "fixtures", "wire", "axis_titles.json",
);

const DS: Dataset = {
  id: "d1",
  name: "titles.csv",
  data: {
    time: [0, 1, 2, 3],
    values: [[1, 50], [2, 60], [3, 55], [4, 70]],
    labels: ["M", "T"],
    units: ["emu", "K"],
    metadata: {},
  },
};

interface Title {
  /** CSS px; null = the template's own title size. */
  size: number | null;
  bold: boolean;
  italic: boolean;
  /** CSS px, x right / y DOWN. */
  offset: [number, number];
}

interface Case {
  name: string;
  view: Partial<PlotView>;
  /** An x-axis break the window's document carries (a break view). */
  breaks?: [number, number][];
  /** One entry per DRAWN axis title. */
  drawn: Partial<Record<AxisKey, Title>>;
}

/** The derived x title (`buildColumns`' time axis). */
const X_TITLE = buildColumns(DS.data, null, null, [0]).xLabel;

const PLAIN: Title = { size: null, bold: false, italic: false, offset: [0, 0] };

const CASES: Case[] = [
  { name: "plain titles", view: { yKeys: [0] }, drawn: { x: PLAIN, y: PLAIN } },
  {
    name: "Format: a bold 20 px y title and an italic 16 px x title",
    view: { yKeys: [0], axisLabelStyles: { y: { size: 20, bold: true }, x: { size: 16, italic: true } } },
    drawn: { x: { ...PLAIN, size: 16, italic: true }, y: { ...PLAIN, size: 20, bold: true } },
  },
  {
    name: "Drag: both titles moved",
    view: { yKeys: [0], axisLabelOffsets: { x: [24, -6], y: [-8, 30] } },
    drawn: { x: { ...PLAIN, offset: [24, -6] }, y: { ...PLAIN, offset: [-8, 30] } },
  },
  {
    name: "Secondary axis: the y2 title formatted and moved",
    view: {
      yKeys: [0, 1], y2Keys: [1],
      axisLabelStyles: { y2: { size: 18, bold: true, italic: true } },
      axisLabelOffsets: { y2: [10, -20] },
    },
    drawn: { x: PLAIN, y: PLAIN, y2: { size: 18, bold: true, italic: true, offset: [10, -20] } },
  },
  {
    name: "x-axis break: formatted and moved titles draw plain on the panels",
    view: {
      yKeys: [0],
      axisLabelStyles: { y: { size: 20, bold: true }, x: { size: 16, italic: true } },
      axisLabelOffsets: { x: [24, -6], y: [-8, 30] },
    },
    breaks: [[1.2, 1.8]],
    drawn: { x: PLAIN, y: PLAIN },
  },
];

const FLAT = CASES.filter((c) => !c.breaks);
const BROKEN = CASES.filter((c) => c.breaks);

function viewOf(c: Case): PlotView {
  return { ...defaultPlotView(), ...c.view };
}

interface Call { text: string; x: number; y: number; font: string; op: number }

function stubCtx(): { ctx: unknown; calls: Call[]; ops: string[] } {
  const calls: Call[] = [];
  const ops: string[] = [];
  const ctx = {
    font: "", fillStyle: "", textAlign: "start", textBaseline: "alphabetic",
    save: () => ops.push("save"),
    restore: () => ops.push("restore"),
    translate: (x: number, y: number) => ops.push(`translate ${x} ${y}`),
    rotate: () => ops.push("rotate"),
    fillText: (text: string, x: number, y: number) => calls.push({ text, x, y, font: ctx.font, op: ops.length }),
    measureText: (text: string) => ({ width: text.length * 8 }) as TextMetrics,
  };
  return { ctx, calls, ops };
}

const AXES_STUB = [
  { side: 2, _lpos: 430, labelGap: 0 },
  { side: 3, _lpos: 12, labelGap: 0 },
  { side: 1, _lpos: 590, labelGap: 0 },
];

/** Draw `plugin` against a stub uPlot; per axis title, its font and anchor. */
function drawTitles(plugin: uPlot.Plugin): Partial<Record<AxisKey, { font: string; at: [number, number] }>> {
  const { ctx, calls, ops } = stubCtx();
  const u = { ctx, axes: AXES_STUB, bbox: { left: 40, top: 10, width: 500, height: 300 }, root: document.createElement("div") };
  (plugin.hooks.draw as (u: uPlot) => void)(u as unknown as uPlot);
  // A title's anchor: its group's translate (a vertical title), else its text origin.
  const out: Partial<Record<AxisKey, { font: string; at: [number, number] }>> = {};
  const texts = new Map<string, AxisKey>([["M (emu)", "y"], ["T (K)", "y2"], [X_TITLE, "x"]]);
  for (const call of calls) {
    const axis = texts.get(call.text);
    if (!axis || out[axis]) continue;
    const save = ops.lastIndexOf("save", call.op);
    const tr = ops.slice(save, call.op).find((op) => op.startsWith("translate"));
    const at: [number, number] = tr ? [Number(tr.split(" ")[1]), Number(tr.split(" ")[2])] : [call.x, call.y];
    out[axis] = { font: call.font, at };
  }
  return out;
}

/** What the canvas draws per axis title, read from the real plugin. */
function canvas(c: Case): Partial<Record<AxisKey, Title>> {
  const view = viewOf(c);
  const channels = effectiveChannels(DS.data, view.yKeys, view.xKey, undefined, view.seriesOrder);
  const payload = buildColumns(DS.data, view.y2Keys, view.xKey, channels);
  made.length = 0;
  const edit = {
    offsets: view.axisLabelOffsets, styles: view.axisLabelStyles, interactive: false,
    onMove: () => {}, onReset: () => {}, onContextMenu: () => {},
  };
  buildOpts(payload, {
    width: 600, height: 400, xScale: "linear", yScale: "linear", tool: "cursor", onReadout: () => {},
    plotted: channels, axisLabelEdit: edit, fontSize: 12,
  });
  const titlePx = 14; // fontSize 12 + 2 (uplotOpts' titlePx)
  if (made.length === 0) {
    // uPlot draws every plain, unmoved title itself.
    return Object.fromEntries((["x", "y", ...(view.y2Keys?.length ? ["y2"] : [])] as AxisKey[]).map((a) => [a, PLAIN]));
  }
  const { args, real } = made[made.length - 1];
  const [asts, style, , drawnFlags] = args;
  // Every axis drawn, at the stored offsets and at none: the difference is the drag.
  const all = { x: !!asts.x, y: !!asts.y, y2: !!asts.y2 };
  const moved = drawTitles(real(asts, style, edit, all));
  const home = drawTitles(real(asts, style, { ...edit, offsets: {} }, all));
  const out: Partial<Record<AxisKey, Title>> = {};
  for (const axis of ["x", "y", "y2"] as AxisKey[]) {
    const m = moved[axis];
    const h = home[axis];
    if (!m || !h) continue;
    const px = Number(/(\d+(?:\.\d+)?)px/.exec(m.font)?.[1]);
    const title: Title = {
      size: drawnFlags?.[axis] && px !== titlePx ? px : null,
      bold: / 700 /.test(` ${m.font} `),
      italic: m.font.startsWith("italic "),
      offset: [m.at[0] - h.at[0], m.at[1] - h.at[1]],
    };
    out[axis] = title;
  }
  return out;
}

/** The request the focused Stage window's Export figure / Copy figure sends. */
function request(c: Case): FigureSpec {
  const view = viewOf(c);
  const document = createFigureDocument({
    id: "w1-doc", name: "Titles", datasetId: "d1", view, ...(c.breaks ? { axisBreaks: { x: c.breaks } } : {}),
  });
  const get = (() => ({
    ...view,
    focusedWindowId: "w1",
    windowsForSave: () => [{ id: "w1", kind: "plot", document }],
    autoSeriesStyles: false,
    defaultTrace: "Line",
  })) as unknown as StoreGet;
  return buildStageFigureSpec(get, DS, "titles", {
    fmt: "svg", style: "default", dpi: 100, title: "", xLabel: "", yLabel: "",
  });
}

/** What the request asks matplotlib to draw per axis title. */
function wire(spec: FigureSpec, axes: AxisKey[]): Partial<Record<AxisKey, Title>> {
  return Object.fromEntries(axes.map((axis) => {
    const st = spec.axis_label_styles?.[axis];
    const off = spec.axis_label_offsets?.[axis];
    return [axis, {
      size: st?.size ?? null,
      bold: st?.bold === true,
      italic: st?.italic === true,
      offset: off ? [off[0], off[1]] : [0, 0],
    }];
  }));
}

function fresh() {
  return { cases: CASES.map((c) => ({ name: c.name, request: request(c), drawn: c.drawn })) };
}

describe("axis-title Format + drag, screen == export", () => {
  it.each(FLAT)("canvas: $name", (c) => {
    expect(canvas(c)).toEqual(c.drawn);
  });

  it.each(FLAT)("request: $name", (c) => {
    expect(wire(request(c), Object.keys(c.drawn) as AxisKey[])).toEqual(c.drawn);
  });

  it.each(BROKEN)("request: $name takes the break renderer's path", (c) => {
    expect(request(c).overrides?.x_breaks).toEqual(c.breaks);
  });

  it("a facet grid sends neither: its canvas draws plain titles", () => {
    const view = { ...viewOf(CASES[1]), facetKey: 1 };
    const document = createFigureDocument({ id: "w1-doc", name: "F", datasetId: "d1", view, facetKey: 1 });
    const get = (() => ({
      ...view, focusedWindowId: "w1", windowsForSave: () => [{ id: "w1", kind: "plot", document }],
      autoSeriesStyles: false, defaultTrace: "Line",
    })) as unknown as StoreGet;
    const spec = buildStageFigureSpec(get, DS, "f", { fmt: "svg", style: "default", dpi: 100, title: "" });
    expect(spec.facets?.length).toBeGreaterThan(0);
    expect(spec.axis_label_styles).toBeUndefined();
    expect(spec.axis_label_offsets).toBeUndefined();
  });

  it("matches the committed fixture the backend half reads", () => {
    const now = fresh();
    if (process.env.AXIS_TITLES_FIXTURE_WRITE) {
      writeFileSync(FIXTURE, `${JSON.stringify(now, null, 2)}\n`, "utf8");
    }
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(JSON.parse(JSON.stringify(now)));
  });
});
