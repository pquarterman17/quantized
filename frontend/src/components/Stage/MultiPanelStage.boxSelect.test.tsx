// Plan item 22: the Select rows box on the panels of a multi-panel layout. Real pointer events on real uPlot panels
// (a facet grid, an x-break row), the rows compared with numpy's selection of the points inside the box in the
// panel's own data coordinates, with the sheet's excluded rows removed and a row window's offset applied
// (`tests/fixtures/wire/box_select_panels.json`, kept honest by `tests/test_box_select_panels_fixture.py`).
// Refusals (a per-channel stack, a grid that greys excluded rows) each name their reason.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { created } = vi.hoisted(() => {
  class NoopPath extends (globalThis as unknown as { Path2D: new () => object }).Path2D {
    moveTo() {}
    lineTo() {}
    addPath() {}
    rect() {}
    arc() {}
    closePath() {}
    bezierCurveTo() {}
  }
  (globalThis as { Path2D?: unknown }).Path2D = NoopPath;
  const mq = { matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} };
  window.matchMedia ??= (() => mq) as unknown as typeof window.matchMedia;
  return { created: [] as unknown[] };
});
vi.mock("uplot", async (orig) => {
  const mod = await orig<{ default: typeof uPlotType }>();
  const Real = mod.default;
  class Spy extends Real {
    constructor(...a: ConstructorParameters<typeof uPlotType>) {
      super(...a);
      created.push(this);
    }
  }
  return { ...mod, default: Spy };
});

import type uPlot from "uplot";
import type uPlotType from "uplot";

import { loadToolPlugins } from "../../lib/axisExtrasHook";
import { breakCompositionFromData, facetCompositionFromBinding } from "../../lib/facet";
import { windowedDataset } from "../../lib/rowWindowDataset";
import { analysisData } from "../../lib/rowstate";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { useToasts } from "../../store/toasts";
import MultiPanelStage from "./MultiPanelStage";

interface Box { x: [number, number]; y: [number, number] }
interface Fixture {
  facet: { x: number[]; y: number[]; g: number[]; excluded: number[]; level: number; box: Box; rows: number[];
    cross: { level: number; x0: number; y: [number, number]; rows: number[] }; window: { from: number; to: number; rows: number[] } };
  break: { x: number[]; y: number[]; breaks: [number, number][]; panel: number; box: Box; rows: number[] };
}
const F = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "tests", "fixtures", "wire", "box_select_panels.json"), "utf-8")) as Fixture;

const sheet = (x: number[], y: number[], g?: number[], excluded?: number[]): Dataset => ({
  id: "d", name: "d.csv", ...(excluded ? { excludedRows: excluded } : {}),
  data: { time: x, values: y.map((v, i) => (g ? [v, g[i]] : [v])), labels: g ? ["y", "g"] : ["y"], units: g ? ["", ""] : [""], metadata: {} },
});
const facetSheet = () => sheet(F.facet.x, F.facet.y, F.facet.g, F.facet.excluded);

const tick = () => new Promise((r) => setTimeout(r, 0));
const panels = () => created as uPlot[];

/** Give a panel jsdom's missing layout: its own plot-area size. */
function lay(u: uPlot): uPlot {
  Object.defineProperty(u.over, "clientWidth", { value: u.bbox.width, configurable: true });
  Object.defineProperty(u.over, "clientHeight", { value: u.bbox.height, configurable: true });
  const box = { left: 0, top: 0, right: u.bbox.width, bottom: u.bbox.height, width: u.bbox.width, height: u.bbox.height, x: 0, y: 0 };
  u.over.getBoundingClientRect = () => ({ ...box, toJSON: () => box });
  return u;
}
function mouse(u: uPlot, type: string, x: number, y: number): void {
  const e = new MouseEvent(type, { button: 0, buttons: type === "mouseup" ? 0 : 1, clientX: x, clientY: y, bubbles: true });
  Object.defineProperty(e, "movementX", { value: 1 }); // uPlot drops a mousemove during a drag that moved 0 px
  (type === "mousemove" || type === "mousedown" ? u.over : document).dispatchEvent(e);
}
/** Drag in panel `u` from (x0, y0) to (x1, y1) in plot-area px, with a mid-way move. */
function drag(u: uPlot, [x0, y0]: [number, number], [x1, y1]: [number, number]): void {
  mouse(u, "mousedown", x0, y0);
  mouse(u, "mousemove", (x0 + x1) / 2, (y0 + y1) / 2);
  mouse(u, "mousemove", x1, y1);
  mouse(u, "mouseup", x1, y1);
}
/** The box in panel `u`'s own data coordinates, as a drag's two corners. */
const corners = (u: uPlot, b: Box): [[number, number], [number, number]] => [
  [u.valToPos(b.x[0], "x"), u.valToPos(b.y[1], "y")],
  [u.valToPos(b.x[1], "x"), u.valToPos(b.y[0], "y")],
];
const selected = () => useApp.getState().selection?.rows;
const toasts = () => useToasts.getState().toasts.map((t) => t.msg).join(" | ");

async function mountFacet(ds: Dataset, extra: Record<string, unknown> = {}) {
  const rowRange = (extra.rowRange ?? undefined) as { from: number; to: number } | undefined;
  useApp.setState({ datasets: [ds], activeId: "d", facetKey: 1, yKeys: [0], xKey: null, stackMode: true, plotTool: "select", ...extra });
  const composition = facetCompositionFromBinding(windowedDataset(ds, rowRange), 1, null, [0]);
  render(<MultiPanelStage composition={composition} />);
  await waitFor(() => expect(panels().length).toBe(3));
  await tick();
  return panels().map(lay);
}

beforeAll(() => loadToolPlugins());
beforeEach(() => {
  created.length = 0;
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  useApp.setState(useApp.getInitialState(), true);
  useToasts.setState({ toasts: [] });
});
afterEach(() => {
  panels().forEach((u) => u.destroy());
  vi.unstubAllGlobals();
});

describe("a facet grid", () => {
  // "hide" prunes the excluded row from the panels (rows after it move up one), "grey" draws it as a muted point.
  describe.each(["hide", "grey"] as const)("with excluded rows %s", (mode) => {
  it("a box in one panel selects that panel's rows, as numpy finds them", async () => {
    const ps = await mountFacet(facetSheet(), { excludedDisplay: mode });
    const [a, b] = corners(ps[F.facet.level], F.facet.box);
    drag(ps[F.facet.level], a, b);
    await waitFor(() => expect(selected()).toEqual(F.facet.rows));
    expect(F.facet.rows.length).toBeGreaterThanOrEqual(3);
    expect(useApp.getState().status).toContain("selected 3 rows in panel");
    // No other panel mirrors the drag.
    ps.filter((_u, i) => i !== F.facet.level).forEach((u) => expect([u.select.width, u.select.height]).toEqual([0, 0]));
  });

  it("the same box drawn in a neighbouring panel selects that panel's own rows, never the first panel's", async () => {
    const ps = await mountFacet(facetSheet(), { excludedDisplay: "hide" });
    const [a, b] = corners(ps[2], F.facet.box);
    drag(ps[2], a, b);
    await waitFor(() => expect(selected()?.length).toBeGreaterThan(0));
    expect(selected()!.every((r) => F.facet.g[r] === 2 && F.facet.x[r] >= 7.5 && F.facet.x[r] <= 25.5 && F.facet.y[r] >= 20 && F.facet.y[r] <= 63)).toBe(true);
    const want = F.facet.x.flatMap((x, r) => (F.facet.g[r] === 2 && x >= 7.5 && x <= 25.5 && F.facet.y[r] >= 20 && F.facet.y[r] <= 63 ? [r] : []));
    expect(selected()).toEqual(want);
  });

  it("a drag that leaves its panel is clipped to the panel where it started", async () => {
    const { level, x0, y, rows } = F.facet.cross;
    const ps = await mountFacet(facetSheet(), { excludedDisplay: "hide" });
    const u = ps[level];
    drag(u, [u.valToPos(x0, "x"), u.valToPos(y[1], "y")], [u.bbox.width + 4000, u.valToPos(y[0], "y")]);
    await waitFor(() => expect(selected()).toEqual(rows));
    expect(selected()!.every((r) => F.facet.g[r] === level)).toBe(true); // no neighbour's rows came with it
  });

  it("a drag that exits its panel keeps following the pointer, clamped to the panel edge", async () => {
    const { level, x0, y } = F.facet.cross;
    const ps = await mountFacet(facetSheet(), { excludedDisplay: "hide" });
    const u = ps[level];
    // What a browser sends: moves over the panel, then mouseleave at the edge, then moves over the page
    // (never over the panel) with the button still down, then the button released out there.
    const start: [number, number] = [u.valToPos(x0, "x"), u.valToPos(y[1], "y")];
    mouse(u, "mousedown", ...start);
    mouse(u, "mousemove", u.bbox.width - 20, u.bbox.height / 2);
    u.over.dispatchEvent(new MouseEvent("mouseleave", { clientX: u.bbox.width + 1, clientY: u.bbox.height / 2 }));
    for (const [px, py] of [[u.bbox.width + 80, u.bbox.height + 40], [u.bbox.width + 400, u.bbox.height + 300]]) {
      document.body.dispatchEvent(new MouseEvent("mousemove", { buttons: 1, clientX: px, clientY: py, bubbles: true }));
    }
    mouse(u, "mouseup", u.bbox.width + 400, u.bbox.height + 300);
    // numpy's answer: the rows of this level inside x0..panel right edge and panel bottom edge..y[1] (excluded rows hidden).
    const [xr, yb] = [u.posToVal(u.bbox.width, "x"), u.posToVal(u.bbox.height, "y")];
    const want = F.facet.x.flatMap((x, r) => (
      F.facet.g[r] === level && !F.facet.excluded.includes(r) && x >= x0 && x <= xr && F.facet.y[r] >= yb && F.facet.y[r] <= y[1] ? [r] : []
    ));
    expect(want.length).toBeGreaterThan(F.facet.cross.rows.length - 1);
    await waitFor(() => expect(selected()).toEqual(want));
  });

  it("honours the plot's row window: the rows are the sheet's, offset by the window's first row", async () => {
    const win = { from: F.facet.window.from, to: F.facet.window.to };
    const ps = await mountFacet(facetSheet(), { rowRange: win, excludedDisplay: mode });
    const [a, b] = corners(ps[F.facet.level], F.facet.box);
    drag(ps[F.facet.level], a, b);
    await waitFor(() => expect(selected()).toEqual(F.facet.window.rows));
  });
  });

  it("a grid split by a group refuses, with its reason, and selects nothing", async () => {
    const ps = await mountFacet(facetSheet(), { groupKey: 1, excludedDisplay: "hide" });
    const [a, b] = corners(ps[F.facet.level], F.facet.box);
    drag(ps[F.facet.level], a, b);
    await waitFor(() => expect(toasts()).toContain("split by a group or an encoding"));
    expect(selected()).toBeUndefined();
  });
});

describe("an x-break row", () => {
  it("a box in a segment selects that segment's rows, as numpy finds them", async () => {
    const { x, y, breaks, panel, box, rows } = F.break;
    const ds = sheet(x, y);
    useApp.setState({ datasets: [ds], activeId: "d", yKeys: [0], xKey: null, plotTool: "select" });
    const composition = breakCompositionFromData(analysisData(ds), breaks, null, [0]);
    render(<MultiPanelStage composition={composition} />);
    await waitFor(() => expect(panels().length).toBe(2));
    await tick();
    const ps = panels().map(lay);
    const [a, b] = corners(ps[panel], box);
    drag(ps[panel], a, b);
    await waitFor(() => expect(selected()).toEqual(rows));
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(useApp.getState().status).toContain(`in panel segment ${panel + 1}`);
  });
});

describe("a per-channel stack", () => {
  it("refuses a box with its reason and selects nothing", async () => {
    const ds = sheet(F.facet.x, F.facet.y);
    ds.data.values = ds.data.values.map((r, i) => [r[0], F.facet.x[i] * 2]);
    ds.data.labels = ["y", "z"];
    ds.data.units = ["", ""];
    useApp.setState({ datasets: [ds], activeId: "d", yKeys: [0, 1], xKey: null, stackMode: true, plotTool: "select" });
    render(<MultiPanelStage composition={null} />);
    await waitFor(() => expect(panels().length).toBe(2));
    await tick();
    const u = lay(panels()[0]);
    drag(u, [u.valToPos(5, "x"), u.valToPos(60, "y")], [u.valToPos(20, "x"), u.valToPos(10, "y")]);
    await waitFor(() => expect(toasts()).toContain("per-channel stack"));
    expect(selected()).toBeUndefined();
  });
});
