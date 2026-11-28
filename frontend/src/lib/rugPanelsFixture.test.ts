// Plan item 20: rug marks on a FACET GRID, an AXIS BREAK and the magnifier INSET, screen == export, as a shared
// wire fixture (`tests/fixtures/wire/rug_panels.json`). Each case records the export request the Stage builds and,
// per panel, the axis limits a REAL uPlot instance settles on (the rug is axes-fraction decoration, so it must not
// pull the data range to 0 in the export) and the X positions the canvas' rug draws (`rugPlugins` over the style the panel's cell draws with:
// `facetCellStyle`, `plainStyle`, `insetCellStyle`). The backend half (`tests/test_export_rug_panels.py`) renders the
// request and compares each panel's rug segments with a numpy selection of the same rows.
//
// Regenerate only after a DELIBERATE rule change:
//   RUG_PANELS_FIXTURE_WRITE=1 npx vitest run src/lib/rugPanelsFixture.test.ts

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import uPlot from "uplot";

import "./uplotPaths"; // provides uPlot's range helpers, as every canvas loads it

import { sharedXDomain, sharedYDomain } from "./facetDomains";
import { buildOpts } from "./uplotOpts";
import { facetCellStyle } from "../components/Stage/facetGridRender";
import { plainStyle } from "../components/Stage/breakPanelRender";
import { insetCellStyle } from "../components/Stage/insetStyle";
import { createFigureDocument } from "./figureDocument";
import { breakCompositionFromData, facetCompositionFromBinding } from "./facet";
import { buildStageFigureSpec } from "./figureSpecStage";
import { loadMarks } from "./marksLoader";
import { breakPanelsOf, facetPanelsOf } from "./composition";
import { buildColumns, composeDisplayPayload, effectiveChannels } from "./plotdata";
import { defaultPlotView } from "./plotview";
import type { PlotPayload } from "./plotdata";
import type { SeriesStyle } from "./seriesStyleTypes";
import type { Dataset } from "./types";
import { rugPlugins } from "./uplotRug";
import { useApp } from "../store/useApp";

// uPlot (imported through the panel renderers) reads matchMedia when it loads, and draws through Path2D (jsdom has neither).
vi.hoisted(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as never;
  (globalThis as unknown as Record<string, unknown>).Path2D ??= class { moveTo() {} lineTo() {} rect() {} arc() {} closePath() {} bezierCurveTo() {} addPath() {} };
});

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "fixtures", "wire", "rug_panels.json");
const RUG: SeriesStyle = { rug: "x", rugLength: 0.08, rugOpacity: 0.4, color: "#3366cc" };

/** x = 0..4, 20..24 (a gap after row 4); y = a row-dependent value, one NaN; facet level = row % 2. */
const X = [0, 1, 2, 3, 4, 20, 21, 22, 23, 24];
const ds = (): Dataset => ({
  id: "d1", name: "rugs",
  data: { time: X, values: X.map((_v, r) => [r === 6 ? NaN : 1 + r * 0.5, r % 2]), labels: ["y", "lvl"], units: ["", ""], metadata: {} },
});

function setup(extra: Record<string, unknown>): void {
  useApp.setState(useApp.getInitialState(), true);
  useApp.setState({
    datasets: [ds()], activeId: "d1", xKey: null, yKeys: [0], stackMode: false, history: [], future: [], excludedDisplay: "hide",
    seriesStyles: { 0: RUG },
    plotWindows: [{
      id: "w1", kind: "plot", title: "", datasetId: "d1", geometry: { x: 0, y: 0, w: 480, h: 360 }, z: 0, winState: "normal",
      bg: "theme", linkGroup: null, pinned: false, view: defaultPlotView(),
      document: createFigureDocument({ id: "fig-w1", name: "w1", datasetId: "d1", view: defaultPlotView() }),
    }],
    focusedWindowId: "w1", ...extra,
  });
}
const requestOf = () => buildStageFigureSpec(useApp.getState, useApp.getState().datasets[0], "rug", { fmt: "svg", style: "default", dpi: 100, title: "", xLabel: "", yLabel: "" });

/** The X of every rug tick a panel with `payload` and `style` draws (the plugin run on a recording stand-in). */
function ticks(payload: Pick<PlotPayload, "data">, style: SeriesStyle | undefined): number[] {
  const xs: number[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, k: string) => (k === "moveTo" ? (x: number, y: number) => y === 120 && xs.push(x) : () => {}),
    set: () => true,
  });
  const u = {
    ctx, bbox: { left: 0, top: 20, width: 200, height: 100 }, data: payload.data, series: [{}, { stroke: "#123456", scale: "y" }],
    valToPos: (v: number) => v,
  } as unknown as uPlot;
  const [plugin] = rugPlugins([style]);
  if (plugin) (plugin.hooks.draw as (u: uPlot) => void)(u);
  return xs;
}

type Lim = [number, number];
interface Built { name: string; request: unknown; canvas: number[][]; limits: { x: Lim; y: Lim }[] }

const live: uPlot[] = [];
afterEach(() => { for (const u of live.splice(0)) u.destroy(); });

/** The axis limits a real uPlot instance settles on for `payload` (the way a panel's cell is built). */
async function limitsOf(payload: PlotPayload, style: SeriesStyle | undefined, extra: { xLim?: Lim | null; yLim?: Lim | null }): Promise<{ x: Lim; y: Lim }> {
  const opts = buildOpts(payload, {
    width: 300, height: 200, tool: "zoom", onReadout: vi.fn(), xScale: "linear", yScale: "linear",
    hidden: payload.series.map(() => false), seriesStyles: [style], ...extra,
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const u = new uPlot(opts, payload.data as uPlot.AlignedData, host);
  live.push(u);
  await new Promise((r) => setTimeout(r, 0)); // uPlot commits its scales async
  const round = (v: number | null | undefined): number => Math.round((v as number) * 1e9) / 1e9;
  return { x: [round(u.scales.x.min), round(u.scales.x.max)], y: [round(u.scales.y.min), round(u.scales.y.max)] };
}
/** The flat plot of every row (what the inset's main axes draw). */
function flatPayload(): PlotPayload {
  const d = ds();
  const channels = effectiveChannels(d.data, [0], null, d.channelRoles, null);
  const v = defaultPlotView();
  return composeDisplayPayload(buildColumns(d.data, v.y2Keys, null, channels), {
    id: d.id, waterfall: v.waterfall, dropped: new Set(), excludedDisplay: "hide",
    fitOverlay: null, baselineOverlay: null, peakOverlay: null, derivOverlay: null, selection: null,
  });
}

const CASES: { name: string; make: () => Promise<Built> }[] = [
  {
    name: "a facet grid draws each panel's own ticks",
    async make() {
      setup({ facetKey: 1 });
      const panels = facetPanelsOf(facetCompositionFromBinding(ds(), 1, null, [0]))!;
      // Screen: one shared X domain (MultiPanelStage's facetXLim), each panel's own Y autoscale.
      const xLim = sharedXDomain(panels);
      const limits = await Promise.all(panels.map((p) => limitsOf(p.payload, facetCellStyle(RUG), { xLim })));
      return { name: this.name, request: requestOf(), canvas: panels.map((p) => ticks(p.payload, facetCellStyle(RUG))), limits };
    },
  },
  {
    name: "an axis break draws each segment's own ticks",
    async make() {
      setup({});
      useApp.getState().breakAtGaps("d1", [[4, 20]]);
      const panels = breakPanelsOf(breakCompositionFromData(ds().data, [[4, 20]], null, [0]))!;
      // Screen: each segment keeps its own X range and they share ONE Y domain (breakYLim).
      const yLim = sharedYDomain(panels, [], false);
      const limits = await Promise.all(panels.map((p) => limitsOf(p.payload, plainStyle(RUG), { yLim })));
      return { name: this.name, request: requestOf(), canvas: panels.map((p) => ticks(p.payload, plainStyle(RUG))), limits };
    },
  },
  {
    name: "the magnifier inset draws its series' ticks",
    async make() {
      setup({ insetMode: true, inset: { x: [0, 4], y: null, yZoom: false, at: [0.5, 0.1, 0.4, 0.4], lines: true } });
      const all = { data: [X, ds().data.values.map((r) => (Number.isNaN(r[0]) ? null : r[0]))] };
      const limits = [await limitsOf(flatPayload(), insetCellStyle(RUG), {})];
      return { name: this.name, request: requestOf(), canvas: [ticks(all as never, insetCellStyle(RUG))], limits };
    },
  },
];

beforeAll(async () => { await loadMarks(); });

describe("rug marks on a facet grid, an axis break and the inset", () => {
  it("a facet grid: one rug per level, only its own finite points", async () => {
    const { canvas } = await CASES[0].make();
    expect(canvas).toEqual([[0, 2, 4, 23], [1, 3, 20, 22, 24]]); // the NaN row (x = 21, level 0) draws no tick
  });
  it("an axis break: one rug per segment", async () => {
    expect((await CASES[1].make()).canvas).toEqual([[0, 1, 2, 3, 4], [20, 22, 23, 24]]);
  });
  it("the inset: every finite point", async () => {
    expect((await CASES[2].make()).canvas).toEqual([[0, 1, 2, 3, 4, 20, 22, 23, 24]]);
  });
  it("the screen's limits start at the data, not at the rug's zero", async () => {
    // facet panel 0: y = 1, 2, 3, 5 (the NaN row draws no point) -> rangeNum snaps out to 0.6..5.4, never down to 0
    const { limits } = await CASES[0].make();
    expect(limits[0]!.y[0]).toBeGreaterThan(0.5);
    expect(limits.map((l) => l.x)).toEqual([[0, 24], [0, 24]]); // the shared union domain
  });
  it("matches the committed wire fixture", async () => {
    const cases: Built[] = [];
    for (const c of CASES) cases.push(await c.make()); // one after another: each case sets up the shared store
    const now = JSON.parse(JSON.stringify({ cases }));
    if (process.env.RUG_PANELS_FIXTURE_WRITE === "1") writeFileSync(FIXTURE, JSON.stringify(now, null, 2) + "\n", "utf8");
    expect(now).toEqual(JSON.parse(readFileSync(FIXTURE, "utf8")));
  });
});
