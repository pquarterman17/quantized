// Publication-grade automatic ticks (audit 6 lane L, P3 / B3):
//
// - The linear, numeric, automatically spaced main axes follow matplotlib's
//   AutoLocator (lib/uplotRightPad.ts). The shared wire fixture
//   `tests/fixtures/wire/tick_density.json` is generated FROM matplotlib; this
//   file runs every case through a REAL uPlot instance, the backend half
//   (`tests/test_tick_density_fixture.py`) checks matplotlib still lands there.
//   How the drawn increment reaches an export: `tickHintFixture.test.ts`.
// - Auto labels carry one decimal count per linear axis ("0.0090", "0.0095"),
//   up to 5 decimals.
// - The screen's X keeps at least three ticks where its labels leave room.

import { readFileSync } from "node:fs";
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

import { buildColumns, composeDisplayPayload, effectiveChannels } from "./plotdata";
import { defaultPlotView, type PlotView } from "./plotview";
import type { Dataset } from "./types";
import { buildOpts, tickFormatter, type BuildOptsArgs } from "./uplotOpts";
import { autoTickStep, xTickSpace, yTickSpace } from "./uplotRightPad";

interface Case { name: string; axis: "x" | "y"; lim: [number, number]; length: number; font: number; step: number; ticks: number[] }
const FIXTURE = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "fixtures", "wire", "tick_density.json"), "utf8")) as { cases: Case[] };

// An MPMS M(T) sweep: 2-298 K, moment falling from ~0.0095 emu.
const T = Array.from({ length: 149 }, (_, i) => 2 + 2 * i);
const DS: Dataset = {
  id: "mpms",
  name: "mpms_mvst.dat",
  data: { time: T, values: T.map((t) => [0.0095 * (2 / t) ** 0.6]), labels: ["Moment"], units: ["emu"], metadata: {} },
};
const VIEW = (): PlotView => ({ ...defaultPlotView(), yKeys: [0] });

const live: uPlot[] = [];
afterEach(() => {
  for (const u of live.splice(0)) u.destroy();
});

function mount(opts: uPlot.Options, data: uPlot.AlignedData): uPlot {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const u = new uPlot(opts, data, host);
  live.push(u);
  return u;
}

/** A real uPlot instance drawing the sweep the way the Stage does. */
async function canvas(extra: Partial<BuildOptsArgs> = {}, width = 900, height = 640): Promise<uPlot> {
  const v = VIEW();
  const channels = effectiveChannels(DS.data, v.yKeys, v.xKey, DS.channelRoles, v.seriesOrder);
  const payload = composeDisplayPayload(buildColumns(DS.data, v.y2Keys, v.xKey, channels), {
    id: DS.id, waterfall: v.waterfall, dropped: new Set(), excludedDisplay: "hide",
    fitOverlay: null, baselineOverlay: null, peakOverlay: null, derivOverlay: null, selection: null,
  });
  const opts = buildOpts(payload, {
    width, height, tool: "zoom", onReadout: vi.fn(), xScale: "linear", yScale: "linear",
    hidden: payload.series.map(() => false), ...extra,
  });
  const u = mount(opts, payload.data as uPlot.AlignedData);
  await new Promise((r) => setTimeout(r, 0)); // uPlot commits its scales async
  return u;
}

type Drawn = uPlot.Axis & { _splits?: number[] };
const majors = (u: uPlot, i: number, key = i ? "y" : "x") => {
  const s = u.scales[key];
  const tol = 1e-9 * (s.max! - s.min!);
  return ((u.axes[i] as Drawn)._splits ?? []).filter((v) => v >= s.min! - tol && v <= s.max! + tol);
};

/** A bare uPlot whose plot area on `c`'s axis is exactly `c.length` px over
 *  `c.lim`, spaced by the canvas' own rule. */
async function bare(c: Case): Promise<number[]> {
  const isX = c.axis === "x";
  const space = isX ? xTickSpace(c.font, true) : yTickSpace(c.font);
  const opts: uPlot.Options = {
    width: isX ? c.length : 100, height: isX ? 100 : c.length, padding: [0, 0, 0, 0], legend: { show: false },
    scales: { x: { time: false, range: (isX ? c.lim : [0, 1]) as uPlot.Range.MinMax }, y: { range: (isX ? [0, 1] : c.lim) as uPlot.Range.MinMax } },
    axes: [
      { size: 0, font: `${c.font}px mono`, ...(isX ? { space, values: tickFormatter(undefined, "linear") } : { show: false }) },
      { size: 0, font: `${c.font}px mono`, ...(isX ? { show: false } : { space }) },
    ],
    series: [{}, {}],
  };
  const u = mount(opts, [[c.lim[0], c.lim[1]], [0, 1]] as uPlot.AlignedData);
  await new Promise((r) => setTimeout(r, 0));
  u.redraw(false, true); // a second pass: the X label floor reads the strings drawn
  return majors(u, isX ? 0 : 1, c.axis);
}

describe("the main axes' tick density: matplotlib's AutoLocator", () => {
  it.each(FIXTURE.cases)("real uPlot == matplotlib: $name", async (c) => {
    expect(autoTickStep(c.lim[0], c.lim[1], c.length, c.font, c.axis === "y" ? 2 : 3)).toBeCloseTo(c.step, 12);
    const got = await bare(c);
    expect(got.length, c.name).toBe(c.ticks.length);
    got.forEach((v, k) => expect(v, c.name).toBeCloseTo(c.ticks[k], 12));
  });

  it("the 640 px MPMS M(T) canvas draws 5-10 Y majors, at the rule's increment", async () => {
    const u = await canvas();
    const y = majors(u, 1);
    expect(y.length).toBeGreaterThanOrEqual(5);
    expect(y.length).toBeLessThanOrEqual(10);
    expect(y[1] - y[0]).toBeCloseTo(0.002, 12);
    expect(majors(u, 0)[1] - majors(u, 0)[0]).toBe(50);
  });

  it("a typed step and a log axis are unchanged", async () => {
    const typed = await canvas({ yLim: [0, 0.01], yStep: 0.0005 });
    expect(majors(typed, 1)).toHaveLength(21);
    const log = await canvas({ yScale: "log" });
    const space = log.axes[1].space as (...a: unknown[]) => number;
    expect(space(log, 1, 1e-5, 1e-2, 600)).toBe(30); // uPlot's own default, as before
  });

  it("the screen's X keeps three ticks where its labels leave room (review L1)", () => {
    // 0.4..2.6 over 160 px at 12 px: matplotlib's 4 bins pick a step of 1, two ticks.
    expect(autoTickStep(0.4, 2.6, 160, 12, 3)).toBe(1);
    const u = { axes: [{ _values: ["1.0", "2.0"] }] } as unknown as uPlot;
    const space = (xTickSpace(12, true) as (...a: unknown[]) => number)(u, 0, 0.4, 2.6, 160);
    expect((160 * 0.5) / 2.2).toBeGreaterThanOrEqual(space); // a 0.5 step: 0.5 ... 2.5
    // ... but never below the labels' own room: 4-character labels need 43 px.
    const wide = { axes: [{ _values: ["10.0", "20.0"] }] } as unknown as uPlot;
    expect((xTickSpace(12, true) as (...a: unknown[]) => number)(wide, 0, 0.4, 2.6, 160)).toBeGreaterThan((160 * 0.5) / 2.2);
  });
});

describe("auto labels: one decimal count per linear axis", () => {
  const auto = () => tickFormatter({ mode: "auto", digits: 3 }, "linear");

  it("pads 0, 0.0005, ..., 0.0095 to four decimals", () => {
    const splits = Array.from({ length: 20 }, (_, i) => Number((i * 0.0005).toFixed(4)));
    const labels = auto()(undefined as never, splits, 1, 30, 0.0005) as string[];
    expect(labels.slice(17)).toEqual(["0.0085", "0.0090", "0.0095"].map((s) => Number(s).toLocaleString(undefined, { minimumFractionDigits: 4 })));
    expect(new Set(labels.map((l) => l.replace(/^.*?[.,](\d+)$/, "$1").length))).toEqual(new Set([4]));
  });

  it("stops padding past 5 decimals, where matplotlib turns to an offset (review M3)", () => {
    const labels = auto()(undefined as never, [0, 1e-9, 2e-9], 1, 30, 1e-9) as string[];
    expect(labels[0]).toBe("0");
    expect(labels[2]).toBe((2e-9).toLocaleString(undefined, { maximumFractionDigits: 9 }));
  });

  it("hands out one formatter per mode, not a fresh closure per call (review L3)", () => {
    expect(tickFormatter(undefined, "reciprocal")).toBe(tickFormatter(undefined, "reciprocal"));
  });
});
