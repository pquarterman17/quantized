// Screen == export ticks through the hint (audit 6 lane L, review H2 / M2),
// pinned as a SHARED wire fixture (`tests/fixtures/wire/tick_hint.json`).
//
// This half draws each case on a REAL uPlot instance built the way the Stage
// builds it, with the focused canvas' tick publisher attached, and records
// the majors it drew beside the exact request the shared spec builder sends
// (Export figure and Publication preview send the same one). The backend half
// (`tests/test_tick_hint_fixture.py`) renders each request at its size and
// checks every axis against `expect`:
//   "screen": the export draws the canvas' majors (the hint fit the axes);
//   "auto":   the hint did not fit, matplotlib placed the ticks (on X with
//             at least three, the screen's own X rule) and the render warned
//             "ticks re-spaced".
// "default style at 3.4x2.6 in" is a custom small size at the default fonts;
// the real aps preset (smaller fonts) keeps the screen's ticks.
//
// Regenerate only after a DELIBERATE rule change:
//   TICK_HINT_FIXTURE_WRITE=1 npx vitest run src/lib/tickHintFixture.test.ts

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

// uPlot reads matchMedia at import and draws through Path2D; jsdom has neither.
vi.hoisted(() => {
  const w = window as unknown as Record<string, unknown>;
  w.matchMedia ??= (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  const g = globalThis as unknown as Record<string, unknown>;
  g.Path2D ??= class { moveTo() {} lineTo() {} rect() {} arc() {} closePath() {} bezierCurveTo() {} addPath() {} };
});

import uPlot from "uplot";

import "./uplotPaths";

import { createFigureDocument } from "./figureDocument";
import { buildFigureSpecFromDocument } from "./figureSpec";
import { publishLiveTickSteps } from "./liveTickSteps";
import { readLiveTickSteps, withLiveTickHints } from "./liveTickStepsSpec";
import { liveTicksPlugin } from "./liveTicksPlugin";
import { buildColumns, composeDisplayPayload, effectiveChannels } from "./plotdata";
import { defaultPlotView, type PlotView } from "./plotview";
import type { Dataset } from "./types";
import { buildOpts } from "./uplotOpts";
import { useApp } from "../store/useApp";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "fixtures", "wire", "tick_hint.json");

type Axis = "x" | "y" | "y2";
interface Case {
  name: string;
  /** Canvas size, CSS px. */
  canvas: [number, number];
  /** Export size, inches; null keeps the style preset's own size. */
  size: [number, number] | null;
  /** The export's style preset (default "default"). */
  style?: string;
  view: Partial<PlotView>;
  expect: Partial<Record<Axis, "screen" | "auto">>;
}

// An MPMS M(T) sweep: moment falling from ~0.0095 emu, and a resistance.
const T = Array.from({ length: 149 }, (_, i) => 2 + 2 * i);
const DS: Dataset = {
  id: "mt",
  name: "mt.csv",
  data: {
    time: T,
    values: T.map((t) => [0.0095 * (2 / t) ** 0.6, 270 + 40 * (t / 298) ** 2]),
    labels: ["Moment", "R"],
    units: ["emu", "ohm"],
    metadata: {},
  },
};
const ZOOM: Partial<PlotView> = { xLim: [37, 211], yLim: [0.0011, 0.0063] };
const CASES: Case[] = [
  { name: "same size: 432x288 px canvas, 6x4 in export", canvas: [432, 288], size: [6, 4], view: {}, expect: { x: "screen", y: "screen" } },
  { name: "small zoomed canvas, default 6x4 in export: the screen's sparser X kept", canvas: [330, 260], size: [6, 4], view: ZOOM, expect: { x: "screen", y: "screen" } },
  { name: "zoomed, default 6x4 in export", canvas: [1000, 640], size: [6, 4], view: ZOOM, expect: { x: "screen", y: "screen" } },
  { name: "zoomed, default style at 3.4x2.6 in: X re-spaced", canvas: [1000, 640], size: [3.4, 2.6], view: ZOOM, expect: { x: "auto", y: "screen" } },
  { name: "2-Y, default 6x4 in export", canvas: [1000, 640], size: [6, 4], view: { yKeys: [0, 1], y2Keys: [1] }, expect: { x: "screen", y: "screen", y2: "screen" } },
  { name: "2-Y, default style at 3.4x2.6 in: X re-spaced to at least 3 ticks", canvas: [1000, 640], size: [3.4, 2.6], view: { yKeys: [0, 1], y2Keys: [1] }, expect: { x: "auto", y: "screen", y2: "screen" } },
  { name: "2-Y, the aps style preset at its own size: the screen's ticks kept", canvas: [1000, 640], size: null, style: "aps", view: { yKeys: [0, 1], y2Keys: [1] }, expect: { x: "screen", y: "screen", y2: "screen" } },
];

const view = (c: Case): PlotView => ({ ...defaultPlotView(), yKeys: [0], ...c.view });

const live: uPlot[] = [];
afterEach(() => {
  for (const u of live.splice(0)) u.destroy();
  publishLiveTickSteps(null);
});

type Drawn = uPlot.Axis & { _splits?: number[]; _values?: (string | null)[] };

/** A real uPlot instance drawing `c` the way the Stage does; its majors. */
async function canvas(c: Case): Promise<Partial<Record<Axis, number[]>>> {
  const v = view(c);
  const channels = effectiveChannels(DS.data, v.yKeys, v.xKey, DS.channelRoles, v.seriesOrder);
  const payload = composeDisplayPayload(buildColumns(DS.data, v.y2Keys, v.xKey, channels), {
    id: DS.id, waterfall: v.waterfall, dropped: new Set(), excludedDisplay: "hide",
    fitOverlay: null, baselineOverlay: null, peakOverlay: null, derivOverlay: null, selection: null,
  });
  const lim = (l: PlotView["xLim"]) => (l && l[0] != null && l[1] != null ? ([l[0], l[1]] as [number, number]) : null);
  const opts = buildOpts(payload, {
    width: c.canvas[0], height: c.canvas[1], tool: "zoom", onReadout: vi.fn(), xScale: "linear", yScale: "linear",
    xLim: lim(v.xLim), yLim: lim(v.yLim), hidden: payload.series.map(() => false),
  });
  useApp.setState({ activeId: DS.id, focusedWindowId: "w1" });
  opts.plugins = [...(opts.plugins ?? []), liveTicksPlugin()];
  const host = document.createElement("div");
  document.body.appendChild(host);
  const u = new uPlot(opts, payload.data as uPlot.AlignedData, host);
  live.push(u);
  await new Promise((r) => setTimeout(r, 0)); // uPlot commits its scales async
  u.redraw(false, true); // the publisher reads the committed axes
  const out: Partial<Record<Axis, number[]>> = {};
  for (const a of u.axes as Drawn[]) {
    const key = (a.scale ?? "x") as Axis;
    const s = u.scales[key];
    out[key] = (a._splits ?? []).filter((t, i) => a._values?.[i] != null && a._values?.[i] !== "" && t >= s.min! - 1e-12 && t <= s.max! + 1e-12);
  }
  return out;
}

async function fresh() {
  const cases = [];
  for (const c of CASES) {
    const ticks = await canvas(c);
    const doc = createFigureDocument({ id: "w1", name: "M(T)", datasetId: DS.id, view: view(c) });
    // The hints Stage Export / Copy and the window's Publication preview add (liveTickSteps.test.ts).
    const spec = withLiveTickHints(buildFigureSpecFromDocument(doc, DS, "mt", { fmt: "svg", style: c.style ?? "default" }), readLiveTickSteps("w1"));
    const request = c.size ? { ...spec, width_in: c.size[0], height_in: c.size[1] } : spec;
    cases.push({ name: c.name, request, canvas: ticks, expect: c.expect });
  }
  return { cases };
}

describe("screen == export ticks through the hint (shared wire fixture)", () => {
  it("every request carries the canvas' drawn increments as hints, never as typed steps", async () => {
    for (const c of (await fresh()).cases) {
      const r = c.request as unknown as Record<string, unknown>;
      expect([r.x_step ?? null, r.y_step ?? null, r.y2_step ?? null], c.name).toEqual([null, null, null]);
      expect(r.x_step_hint, c.name).toBeCloseTo(c.canvas.x![1] - c.canvas.x![0], 9);
      expect(r.y_step_hint, c.name).toBeCloseTo(c.canvas.y![1] - c.canvas.y![0], 9);
    }
  });

  it("matches the committed fixture the backend half reads", async () => {
    const now = await fresh();
    if (process.env.TICK_HINT_FIXTURE_WRITE) writeFileSync(FIXTURE, `${JSON.stringify(now, null, 2)}\n`, "utf8");
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(JSON.parse(JSON.stringify(now)));
  });
});
