// Origin-style multiple Y axes (gap audit 4 G11), screen == export, pinned
// as a SHARED wire fixture (`tests/fixtures/wire/multi_y.json`).
//
// This half draws each case on a REAL uPlot instance (node-canvas backs jsdom
// here), built the way the Stage builds it -- the payload, `multiYView`, then
// `buildOpts` -- and MEASURES what it laid out: every right-hand axis' outward
// offset from the frame (uPlot's own `_pos`, never the sizes the code under
// test assigned), its title, colour, scale, range, and the majors it drew with
// their labels; and which axis each series rides, with its stroke. Beside that
// it records the exact request the app sends. The backend half
// (`tests/test_export_multi_y_wire.py`) renders that request with the real
// matplotlib export and reads the same values back from what it DREW.
//
// Regenerate only after a DELIBERATE rule change:
//   MULTI_Y_FIXTURE_WRITE=1 npx vitest run src/lib/multiYFixture.test.ts

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// uPlot reads matchMedia at import and draws through Path2D; jsdom has neither.
vi.hoisted(() => {
  const w = window as unknown as Record<string, unknown>;
  w.matchMedia ??= (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  const g = globalThis as unknown as Record<string, unknown>;
  g.Path2D ??= class { moveTo() {} lineTo() {} rect() {} arc() {} closePath() {} bezierCurveTo() {} addPath() {} };
});

import uPlot from "uplot";

import "./uplotPaths"; // uPlot's range helpers, as every canvas loads them

import { loadAxisExtras } from "./axisExtrasHook";
import { buildErrorSpans } from "./errorbars";
import { createFigureDocument, figureDocumentToPlotView, type FigureDocument } from "./figureDocument";
import { buildFigureSpecFromDocument } from "./figureSpec";
import { MULTI_Y_SLOT_PT, multiYView, newExtraYAxis, type ExtraYAxis } from "./multiY";
import { buildColumns, effectiveChannels } from "./plotdata";
import { defaultPlotView, type PlotView } from "./plotview";
import { installSeriesPalette } from "./regressionMatrix.testkit";
import { rampView } from "./seriesRampImpl";
import type { Dataset } from "./types";
import { buildOpts } from "./uplotOpts";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "fixtures", "wire", "multi_y.json");

// Transport-style channels: 0 T (K), 1 R (ohm), 2 M (emu), 3 P (mbar),
// 4 F (%) for a probability axis, 5 G (count) for log2, 6 dP (mbar) = P's ±.
function dataset(): Dataset {
  const t = [0, 1, 2, 3, 4, 5];
  return {
    id: "multi-y",
    name: "transport.csv",
    data: {
      time: t,
      values: t.map((i) => [300 - 10 * i, 1 + 0.5 * i, 10 ** (i - 6), 2 + i, 5 + 18 * i, 2 ** (i + 0.5), 0.5]),
      labels: ["T", "R", "M", "P", "F", "G", "dP"],
      units: ["K", "ohm", "emu", "mbar", "%", "count", "mbar"],
      metadata: {},
    },
  };
}

interface Case {
  name: string;
  view: Partial<PlotView>;
}

const RED = "#c0392b";
const BLUE = "#2e86c1";
const ax = (over: Partial<ExtraYAxis> = {}): ExtraYAxis => ({ ...newExtraYAxis(), ...over });

const CASES: Case[] = [
  {
    name: "Y2 then Y3 log then Y4 fixed, own colours",
    view: {
      yKeys: [0, 1, 2, 3], y2Keys: [1],
      yAxes: [ax({ scale: "log", color: RED }), ax({ lim: [0, 10], step: 2, fmt: { mode: "fixed", digits: 1 }, label: "Pressure (mbar)", color: BLUE })],
      yAxisOf: { 2: 3, 3: 4 },
    },
  },
  { name: "Y3 without a Y2 sits in the first slot", view: { yKeys: [0, 3], yAxes: [ax({ lim: [1, 9], step: 4 })], yAxisOf: { 3: 3 } } },
  {
    name: "two series share Y3; display order interleaves",
    view: { yKeys: [1, 0, 3], y2Keys: [0], yAxes: [ax({ lim: [0, 300], step: 100 })], yAxisOf: { 1: 3, 3: 3 } },
  },
  { name: "an orphan assignment draws on Y1", view: { yKeys: [0, 3], yAxes: [], yAxisOf: { 3: 5 } } },
  {
    name: "a colour gradient runs across every axis",
    view: { yKeys: [0, 1, 3], y2Keys: [1], yAxes: [ax({ lim: [0, 10], step: 5, label: "P", color: "#117a65" })], yAxisOf: { 3: 3 }, seriesRamp: { map: "viridis" } },
  },
  {
    // Review H2: an axis whose every series is hidden takes no slot -- even
    // with a fixed range, which keeps uPlot from hiding it on its own.
    name: "a hidden Y3 series frees its slot",
    view: { yKeys: [0, 1, 3], yAxes: [ax({ lim: [0, 5] }), ax({ lim: [0, 10], step: 5 })], yAxisOf: { 1: 3, 3: 4 }, hiddenChannels: [1] },
  },
  {
    name: "a hidden Y2 series takes Y2 off the right",
    view: { yKeys: [0, 1, 3], y2Keys: [1], y2Lim: [0, 5], yAxes: [ax({ lim: [0, 10], step: 5 })], yAxisOf: { 3: 3 }, hiddenChannels: [1] },
  },
  {
    // Review M1: Y2's gap-#5 offset moves Y2's own line, never the slots outside it.
    name: "a Y2 axis offset leaves Y3 one slot out",
    view: { yKeys: [0, 1, 3], y2Keys: [1], y2Fmt: { mode: "auto", digits: 2, offset: 10 }, yAxes: [ax({ lim: [0, 10], step: 5 })], yAxisOf: { 3: 3 } },
  },
  { name: "a Log2 Y3", view: { yKeys: [0, 5], yAxes: [ax({ scale: "log", fmt: { mode: "auto", digits: 2, base: "2" } })], yAxisOf: { 5: 3 } } },
  { name: "a probability Y3", view: { yKeys: [0, 4], yAxes: [ax({ fmt: { mode: "auto", digits: 2, prob: "percent" } })], yAxisOf: { 4: 3 } } },
  {
    name: "custom ticks on Y3",
    view: { yKeys: [0, 3], yAxes: [ax({ lim: [0, 10], fmt: { mode: "auto", digits: 2, custom: { at: [2.5, 7.5], labels: ["low", "high"] } } })], yAxisOf: { 3: 3 } },
  },
  {
    name: "error bars on a Y3 series widen Y3's range",
    view: { yKeys: [0, 3], errKeys: { 3: 6 }, yAxes: [ax({ step: 2 })], yAxisOf: { 3: 3 } },
  },
];

function figure(c: Case): FigureDocument {
  const view: PlotView = { ...defaultPlotView(), legendPos: "nw", yAxisLabel: "Temperature (K)", ...c.view };
  return createFigureDocument({ id: "w1", name: "Multi-Y", datasetId: "multi-y", view });
}

const live: uPlot[] = [];
afterEach(() => {
  live.splice(0).forEach((u) => u.destroy());
});

type Axis = uPlot.Axis & { _pos: number; _size: number; _show: boolean; _splits?: number[]; _values?: (string | null)[] };

/** The canvas: a real uPlot instance drawing this case as the Stage does. */
async function canvas(c: Case) {
  const ds = dataset();
  const doc = figure(c);
  const view = rampView(figureDocumentToPlotView(doc), ds.data, undefined, {});
  const plotted = effectiveChannels(ds.data, view.yKeys, view.xKey, undefined, view.seriesOrder);
  const shown = multiYView(buildColumns(ds.data, view.y2Keys, view.xKey, plotted), plotted, { ...view, active: ds, multiPanel: false });
  const payload = shown.payload!;
  const hidden = payload.series.map((_, i) => view.hiddenChannels.includes(plotted[i]));
  const opts = buildOpts(payload, {
    width: 900, height: 600, tool: "cursor", onReadout: () => {},
    yScale: view.yScale, xScale: view.xScale, yFmt: view.yFmt, y2Fmt: view.y2Fmt, y2Scale: view.y2Scale, y2Lim: view.y2Lim,
    yAxisLabel: view.yAxisLabel, yAxes: shown.axes, plotted, hidden,
    errorSpans: buildErrorSpans(ds.data, plotted, doc.bindings.errors),
    seriesStyles: plotted.map((ch) => view.seriesStyles[ch]),
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const u = new uPlot(opts, payload.data as uPlot.AlignedData, host);
  live.push(u);
  await new Promise((r) => setTimeout(r, 0)); // uPlot commits its scales async
  const pxr = devicePixelRatio || 1;
  const frameRight = (u.bbox.left + u.bbox.width) / pxr;
  const axes = (u.axes as Axis[])
    .filter((a) => Number(a.side) === 1 && a.show !== false && a._show)
    .map((a) => {
      const key = a.scale ?? "y2";
      const s = u.scales[key];
      const majors = (a._splits ?? []).map((v, i) => [v, a._values?.[i]] as const).filter(([v, t]) => t != null && t !== "" && v >= s.min! && v <= s.max!);
      const ink = (x: uPlot.Axis) => String(typeof x.stroke === "function" ? x.stroke(u, 0) : x.stroke);
      const stroke = ink(a);
      return {
        axis: key === "y2" ? 2 : Number(key.slice(1)),
        offset_pt: Math.round(((a._pos - frameRight) * 72) / 96 * 1000) / 1000,
        label: String(a.label ?? ""),
        // The default ink is the theme's on screen and matplotlib's in the export (as for X / Y / Y2): only an own colour compares.
        color: stroke === ink(u.axes[1]) ? null : stroke,
        range: [s.min, s.max],
        ticks: majors.map(([v]) => v),
        tick_labels: majors.map(([, t]) => String(t)),
      };
    });
  const series = u.series.slice(1).map((s, i) => ({
    label: String(s.label),
    axis: s.scale === "y" ? 1 : Number(String(s.scale).slice(1)),
    color: String(s.stroke instanceof Function ? s.stroke(u, i + 1) : s.stroke),
    shown: s.show !== false,
  }));
  return { axes, series, note: shown.note };
}

function request(c: Case) {
  return buildFigureSpecFromDocument(figure(c), dataset(), "multiy", { fmt: "svg" });
}

let restore: () => void = () => {};
beforeAll(async () => {
  restore = installSeriesPalette();
  await loadAxisExtras(); // the Y3+ axis builder rides the axis-extras chunk
});
afterAll(() => restore());

async function fresh() {
  const cases = [];
  for (const c of CASES) cases.push({ name: c.name, request: request(c), canvas: await canvas(c) });
  return { slot_pt: MULTI_Y_SLOT_PT, cases };
}

const at = (name: string) => CASES.find((c) => c.name === name)!;
const extraAt = async (name: string) => (await canvas(at(name))).axes.filter((a) => a.axis >= 3).map((a) => [a.axis, a.offset_pt]);

describe("multiple Y axes: the canvas and the export agree (shared wire fixture)", () => {
  it("stacks the right axes outward one slot at a time, Y2 first, measured on a real layout", async () => {
    const first = await canvas(CASES[0]);
    expect(first.axes.map((a) => [a.axis, a.offset_pt])).toEqual([[2, 0], [3, MULTI_Y_SLOT_PT], [4, 2 * MULTI_Y_SLOT_PT]]);
    expect(first.axes[1]).toMatchObject({ color: RED, label: "M (emu)" });
    expect(first.axes[2]).toMatchObject({ label: "Pressure (mbar)", color: BLUE, ticks: [0, 2, 4, 6, 8, 10] });
    expect(first.series.map((s) => s.axis)).toEqual([1, 2, 3, 4]);
    expect(await extraAt("Y3 without a Y2 sits in the first slot")).toEqual([[3, 0]]);
  });

  it("a hidden series' axis takes no slot (review H2), and a hidden Y2 none either", async () => {
    expect(await extraAt("a hidden Y3 series frees its slot")).toEqual([[4, 0]]);
    const y2 = await canvas(at("a hidden Y2 series takes Y2 off the right"));
    expect(y2.axes.map((a) => [a.axis, a.offset_pt])).toEqual([[3, 0]]);
  });

  it("a Y2 offset does not push Y3 out (review M1)", async () => {
    expect(await extraAt("a Y2 axis offset leaves Y3 one slot out")).toEqual([[3, MULTI_Y_SLOT_PT]]);
  });

  it("an orphan assignment draws on Y1 and is reported", async () => {
    const orphan = await canvas(at("an orphan assignment draws on Y1"));
    expect(orphan.axes).toEqual([]);
    expect(orphan.series.map((s) => s.axis)).toEqual([1, 1]);
    expect(orphan.note).toMatch(/no longer exists/);
    expect(request(at("an orphan assignment draws on Y1")).y_axes).toBeUndefined();
  });

  it("the request carries each extra axis with its channels, and Y2 never repeats one", () => {
    const spec = request(CASES[0]);
    expect(spec.y2_keys).toEqual([1]);
    expect(spec.y_axes?.map((a) => a.keys)).toEqual([[2], [3]]);
  });

  it("matches the committed fixture the backend half reads", async () => {
    const now = await fresh();
    if (process.env.MULTI_Y_FIXTURE_WRITE) writeFileSync(FIXTURE, `${JSON.stringify(now, null, 2)}\n`, "utf8");
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(JSON.parse(JSON.stringify(now)));
  });
});
