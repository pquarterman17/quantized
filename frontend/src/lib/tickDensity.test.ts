// Publication-grade automatic ticks (audit 6 lane L, P3 / B3):
//
// - ONE density rule, matplotlib's AutoLocator, on the canvas and in every
//   export (lib/uplotRightPad.ts). The shared wire fixture
//   `tests/fixtures/wire/tick_density.json` is generated FROM matplotlib; this
//   file checks the canvas port lands on the same increments, the backend half
//   (`tests/test_tick_density_fixture.py`) that matplotlib still does.
// - Auto labels carry one decimal count per linear axis ("0.0090", "0.0095").
// - Export figure and Publication preview send the same (automatic, absent)
//   `y_step` for one graph, whatever the canvas drew: matplotlib then picks for
//   the export's own size, so a 6x4 in PDF no longer inherits the screen's
//   tick step.

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

import { createFigureDocument } from "./figureDocument";
import { buildFigureSpecFromDocument } from "./figureSpec";
import { buildStageFigureSpec } from "./figureSpecStage";
import { buildColumns, composeDisplayPayload, effectiveChannels } from "./plotdata";
import { defaultPlotView, type PlotView } from "./plotview";
import type { Dataset } from "./types";
import { buildOpts, tickFormatter, type BuildOptsArgs } from "./uplotOpts";
import { autoTickStep } from "./uplotRightPad";

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
  const host = document.createElement("div");
  document.body.appendChild(host);
  const u = new uPlot(opts, payload.data as uPlot.AlignedData, host);
  live.push(u);
  await new Promise((r) => setTimeout(r, 0)); // uPlot commits its scales async
  return u;
}

type Drawn = uPlot.Axis & { _splits?: number[] };
const majors = (u: uPlot, i: number) => {
  const s = u.scales[i ? "y" : "x"];
  return ((u.axes[i] as Drawn)._splits ?? []).filter((v) => v >= s.min! && v <= s.max!);
};

describe("one tick-density rule: matplotlib's AutoLocator", () => {
  it.each(FIXTURE.cases)("canvas rule == matplotlib: $name", (c) => {
    expect(autoTickStep(c.lim[0], c.lim[1], c.length, c.font, c.axis === "y" ? 2 : 3)).toBeCloseTo(c.step, 12);
  });

  it("the 640 px MPMS M(T) canvas draws 5-10 Y majors, at the rule's increment", async () => {
    const u = await canvas();
    const y = majors(u, 1);
    expect(y.length).toBeGreaterThanOrEqual(5);
    expect(y.length).toBeLessThanOrEqual(10);
    expect(y[1] - y[0]).toBeCloseTo(0.002, 12);
    expect(majors(u, 0)[1] - majors(u, 0)[0]).toBe(50); // X: 0, 50, ..., 300 as the 6 in export
  });

  it("a typed step and a log axis are unchanged", async () => {
    const typed = await canvas({ yLim: [0, 0.01], yStep: 0.0005 });
    expect(majors(typed, 1)).toHaveLength(21);
    const log = await canvas({ yScale: "log" });
    const space = log.axes[1].space as (...a: unknown[]) => number;
    expect(space(log, 1, 1e-5, 1e-2, 600)).toBe(30); // uPlot's own default, as before
  });
});

describe("auto labels: one decimal count per linear axis", () => {
  it("pads 0, 0.0005, ..., 0.0095 to four decimals", () => {
    const splits = Array.from({ length: 20 }, (_, i) => Number((i * 0.0005).toFixed(4)));
    const labels = tickFormatter({ mode: "auto", digits: 3 }, "linear")!(undefined as never, splits, 1, 30, 0.0005) as string[];
    expect(labels.slice(17)).toEqual(["0.0085", "0.0090", "0.0095"].map((s) => Number(s).toLocaleString(undefined, { minimumFractionDigits: 4 })));
    expect(new Set(labels.map((l) => l.replace(/^.*?[.,](\d+)$/, "$1").length))).toEqual(new Set([4]));
  });
});

describe("Export figure and Publication preview send one tick rule", () => {
  it("both leave the automatic y_step to matplotlib at the export size, whatever the canvas drew", async () => {
    await canvas(); // the focused canvas has drawn its ticks
    const document = createFigureDocument({ id: "w1", name: "M(T)", datasetId: DS.id, view: VIEW() });
    const state = {
      ...VIEW(), autoSeriesStyles: false, focusedWindowId: "w1",
      windowsForSave: () => [{ id: "w1", kind: "plot", datasetId: DS.id, view: VIEW(), document }],
    };
    const o = { fmt: "pdf", style: "default", dpi: 300, title: "", xLabel: "", yLabel: "" };
    const exported = buildStageFigureSpec((() => state) as never, DS, "mpms", o);
    const preview = buildFigureSpecFromDocument(document, DS, "mpms", { fmt: "pdf" });
    expect([exported.x_step, exported.y_step]).toEqual([preview.x_step, preview.y_step]);
    expect(exported.y_step ?? null).toBeNull();
  });
});
