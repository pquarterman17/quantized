// Axis-break export range (#1227): the screen gives every segment of an x-break ONE exact y domain
// (`sharedYDomain`, unpadded); the export used to autoscale each with matplotlib's 5 % padding. This pins
// screen == export as a shared wire fixture (`tests/fixtures/wire/break_y_domain.json`): each case records
// the export request the Stage builds and, per segment, the limits a REAL uPlot instance settles on when
// given that domain. The backend half (`tests/test_export_break_y_domain.py`) renders the request and
// compares every exported panel's y limits with them.
//
// Regenerate only after a DELIBERATE rule change:
//   BREAK_Y_DOMAIN_FIXTURE_WRITE=1 npx vitest run src/lib/breakYDomainFixture.test.ts

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import uPlot from "uplot";

import "./uplotPaths"; // provides uPlot's range helpers, as every canvas loads it

import { sharedYDomain } from "./facetDomains";
import { buildOpts } from "./uplotOpts";
import { plainStyle } from "../components/Stage/breakPanelRender";
import { createFigureDocument } from "./figureDocument";
import { breakCompositionFromData } from "./facet";
import { buildStageFigureSpec } from "./figureSpecStage";
import { breakPanelsOf } from "./composition";
import { defaultPlotView } from "./plotview";
import type { PlotPayload } from "./plotdata";
import type { AxisScale, Dataset } from "./types";
import { useApp } from "../store/useApp";

vi.hoisted(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as never;
  (globalThis as unknown as Record<string, unknown>).Path2D ??= class { moveTo() {} lineTo() {} rect() {} arc() {} closePath() {} bezierCurveTo() {} addPath() {} };
});

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "fixtures", "wire", "break_y_domain.json");

/** x = 0..4, 20..24 (a gap after row 4, broken at 4..20); three y columns of different ranges. */
const X = [0, 1, 2, 3, 4, 20, 21, 22, 23, 24];
const COLS: number[][] = [
  [1.5, 2.25, 3, 2.75, 4.5, 3.5, 2, 4.25, 5, 5.75],
  [-3, -2, -1.5, 0, 0.5, 1, -2.5, 2, 3, 6.5],
  [0, 10, 100, 1000, 20, 50, 5, 2000, 30, 1],
];
const ds = (): Dataset => ({
  id: "d1", name: "breaks",
  data: { time: X, values: X.map((_v, r) => COLS.map((c) => c[r]!)), labels: ["a", "b", "c"], units: ["", "", ""], metadata: {} },
});

function setup(yKeys: number[], yScale: AxisScale): void {
  useApp.setState(useApp.getInitialState(), true);
  const view = { ...defaultPlotView(), yScale };
  useApp.setState({
    datasets: [ds()], activeId: "d1", xKey: null, yKeys, stackMode: false, history: [], future: [], excludedDisplay: "hide",
    plotWindows: [{
      id: "w1", kind: "plot", title: "", datasetId: "d1", geometry: { x: 0, y: 0, w: 480, h: 360 }, z: 0, winState: "normal",
      bg: "theme", linkGroup: null, pinned: false, view,
      document: createFigureDocument({ id: "fig-w1", name: "w1", datasetId: "d1", view }),
    }],
    focusedWindowId: "w1", yScale,
  });
}
const requestOf = () => buildStageFigureSpec(useApp.getState, useApp.getState().datasets[0], "brk", { fmt: "svg", style: "default", dpi: 100, title: "", xLabel: "", yLabel: "" });

type Lim = [number, number];
const live: uPlot[] = [];
afterEach(() => { for (const u of live.splice(0)) u.destroy(); });

/** The y limits a real uPlot instance settles on for `payload` under the shared `yLim` (the way a break panel is built). */
async function yLimitsOf(payload: PlotPayload, yLim: Lim | null, yScale: AxisScale): Promise<Lim> {
  const opts = buildOpts(payload, {
    width: 300, height: 200, tool: "zoom", onReadout: vi.fn(), xScale: "linear", yScale,
    hidden: payload.series.map(() => false), seriesStyles: payload.series.map(() => plainStyle(undefined)), yLim,
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const u = new uPlot(opts, payload.data as uPlot.AlignedData, host);
  live.push(u);
  await new Promise((r) => setTimeout(r, 0)); // uPlot commits its scales async
  const round = (v: number | null | undefined): number => Math.round((v as number) * 1e9) / 1e9;
  return [round(u.scales.y.min), round(u.scales.y.max)];
}

interface Built { name: string; request: unknown; domain: Lim | null; limits: Lim[] }
const CASES: { name: string; yKeys: number[]; yScale: AxisScale }[] = [
  { name: "one series, linear", yKeys: [0], yScale: "linear" },
  { name: "two series, negatives, linear", yKeys: [0, 1], yScale: "linear" },
  { name: "log y skips the zero", yKeys: [2], yScale: "log" },
];

async function make(c: (typeof CASES)[number]): Promise<Built> {
  setup(c.yKeys, c.yScale);
  useApp.getState().breakAtGaps("d1", [[4, 20]]);
  const panels = breakPanelsOf(breakCompositionFromData(ds().data, [[4, 20]], null, c.yKeys))!;
  const domain = sharedYDomain(panels, [], c.yScale !== "linear");
  const limits = await Promise.all(panels.map((p) => yLimitsOf(p.payload, domain, c.yScale)));
  const round = (v: number): number => Math.round(v * 1e9) / 1e9;
  return { name: c.name, request: requestOf(), domain: domain && [round(domain[0]), round(domain[1])], limits };
}

describe("an exported axis break uses the screen's one exact y domain", () => {
  it("the screen's domain is the unpadded min and max of what is shown", async () => {
    expect((await make(CASES[0]!)).domain).toEqual([1.5, 5.75]);
    expect((await make(CASES[1]!)).domain).toEqual([-3, 6.5]);
    expect((await make(CASES[2]!)).domain).toEqual([1, 2000]); // the 0 row is not drawable on a log axis
  });
  it("matches the committed wire fixture", async () => {
    const cases: Built[] = [];
    for (const c of CASES) cases.push(await make(c)); // one after another: each case sets up the shared store
    const now = JSON.parse(JSON.stringify({ cases }));
    if (process.env.BREAK_Y_DOMAIN_FIXTURE_WRITE === "1") writeFileSync(FIXTURE, JSON.stringify(now, null, 2) + "\n", "utf8");
    expect(now).toEqual(JSON.parse(readFileSync(FIXTURE, "utf8")));
    for (const c of now.cases as Built[]) for (const l of c.limits) expect(l).toEqual(c.domain); // every segment shares it
  });
});
