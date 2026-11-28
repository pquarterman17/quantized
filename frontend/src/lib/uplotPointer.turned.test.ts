// Plan item 22: the pointer tools on a TURNED plot (horizontal bars, Plot > Exchange X-Y axes: X runs up the side).
// Real pointer events on a real uPlot built with `exchangeXY`; the rows each tool takes are compared with numpy's
// selection of the points inside the rectangle in DATA coordinates (`tests/fixtures/wire/box_select_panels.json`,
// kept honest by `tests/test_box_select_panels_fixture.py`). Select rows goes through the real
// `usePlotStageActions.onRangeSelect` into the row-state model; the lasso through `lassoMask` and the store.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
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
});

import uPlot from "uplot";

import { usePlotStageActions } from "../components/Stage/usePlotStageActions";
import { usePickedPoints } from "../store/pickedPoints";
import { useApp } from "../store/useApp";
import { loadToolPlugins } from "./axisExtrasHook";
import type { PlotPayload } from "./plotdata";
import { sliceBoxOf } from "./plotSlice";
import type { Dataset } from "./types";
import { buildOpts, type BuildOptsArgs } from "./uplotOpts";
import { orientTurnSettled, turnedOf } from "./uplotOrient";
import { lassoPlugin } from "./uplotLasso";
import { turnPlugins } from "./uplotTurn";

interface Case { x: number[]; y: number[]; box: { x: [number, number]; y: [number, number] }; rows: number[] }
const FIXTURE = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "fixtures", "wire", "box_select_panels.json"), "utf-8")) as { turned: Case };
const C = FIXTURE.turned;

const payload: PlotPayload = { data: [C.x, C.y] as PlotPayload["data"], series: [{ label: "y", unit: "" }], xLabel: "x", xUnit: "" };
const ds: Dataset = { id: "d", name: "d.csv", data: { time: C.x, values: C.y.map((v) => [v]), labels: ["y"], units: [""], metadata: {} } };
const live: uPlot[] = [];
const tick = () => new Promise((r) => setTimeout(r, 0)); // uPlot commits on a microtask

async function mount(extra: Partial<BuildOptsArgs> & { tool: BuildOptsArgs["tool"] }): Promise<uPlot> {
  const opts = buildOpts(payload, { width: 600, height: 400, xScale: "linear", yScale: "linear", onReadout: vi.fn(), linearPaths: uPlot.paths.linear!(), exchangeXY: true, ...extra });
  const u = new uPlot(opts, payload.data, document.body.appendChild(document.createElement("div")));
  live.push(u);
  await tick();
  // jsdom lays nothing out: report uPlot's own plotting-area size (pxRatio 1).
  Object.defineProperty(u.over, "clientWidth", { value: u.bbox.width });
  Object.defineProperty(u.over, "clientHeight", { value: u.bbox.height });
  const box = { left: 0, top: 0, right: u.bbox.width, bottom: u.bbox.height, width: u.bbox.width, height: u.bbox.height, x: 0, y: 0 };
  u.over.getBoundingClientRect = () => ({ ...box, toJSON: () => box });
  return u;
}

let cur: uPlot; // the plot being dragged: uPlot listens for mousemove on its own plot area
function down(u: uPlot, x: number, y: number): void {
  cur = u;
  u.over.dispatchEvent(new MouseEvent("mousedown", { button: 0, clientX: x, clientY: y, bubbles: true }));
}
function move(x: number, y: number): void {
  const e = new MouseEvent("mousemove", { clientX: x, clientY: y, bubbles: true });
  Object.defineProperty(e, "movementX", { value: 1 }); // uPlot drops a mousemove during a drag that moved 0 px
  cur.over.dispatchEvent(e);
}
const up = (x: number, y: number, shiftKey = false) => document.dispatchEvent(new MouseEvent("mouseup", { clientX: x, clientY: y, shiftKey, bubbles: true }));

/** Where the numpy box's corners are on the turned plot, in plot-area px: X is vertical, Y horizontal. */
function corners(u: uPlot) {
  const { x, y } = C.box;
  return { left: u.valToPos(y[0], "y"), right: u.valToPos(y[1], "y"), top: u.valToPos(x[1], "x"), bottom: u.valToPos(x[0], "x") };
}

beforeAll(async () => {
  await loadToolPlugins();
  await orientTurnSettled;
});
beforeEach(() => {
  useApp.setState({
    datasets: [ds], activeId: "d", selectedIds: [], selection: null, plotTool: "select", xKey: null, yKeys: [0], y2Keys: null,
    hiddenChannels: [], seriesOrder: [], seriesStyles: {}, seriesLabels: {}, workbooks: [], history: [], future: [], status: "", exchangeXY: true,
  });
  usePickedPoints.setState({ points: [] });
});
afterEach(() => live.splice(0).forEach((u) => u.destroy()));

describe("a turned plot", () => {
  it("is turned by Exchange X-Y, and the box lands X up the side", async () => {
    expect(turnedOf(useApp.getState())).toBe(true);
    const u = await mount({ tool: "select" });
    expect(u.scales.x.ori).toBe(1);
    const c = corners(u);
    expect(c.right).toBeGreaterThan(c.left); // Y runs left to right
    expect(c.bottom).toBeGreaterThan(c.top); // X runs bottom to top
  });
});

describe("Select rows on a turned plot", () => {
  it("a dragged box selects the rows numpy finds inside it, through the real action and the row-state model", async () => {
    const { result } = renderHook(() => usePlotStageActions({ current: null }, payload, ds, undefined, [0]));
    const u = await mount({ tool: "select", onRangeSelect: result.current.onRangeSelect });
    const c = corners(u);
    down(u, c.left, c.top);
    move((c.left + c.right) / 2, (c.top + c.bottom) / 2);
    move(c.right, c.bottom);
    up(c.right, c.bottom);
    await waitFor(() => expect(useApp.getState().selection?.rows).toEqual(C.rows));
    expect(C.rows.length).toBeGreaterThanOrEqual(3);
  });

  it("an upright plot gives the same rows for the same data box (the transform is the only difference)", async () => {
    const { result } = renderHook(() => usePlotStageActions({ current: null }, payload, ds, undefined, [0]));
    const u = await mount({ tool: "select", onRangeSelect: result.current.onRangeSelect, exchangeXY: false });
    expect(u.scales.x.ori).toBe(0);
    const [x0, x1] = [u.valToPos(C.box.x[0], "x"), u.valToPos(C.box.x[1], "x")];
    const [y0, y1] = [u.valToPos(C.box.y[1], "y"), u.valToPos(C.box.y[0], "y")];
    down(u, x0, y0);
    move(x1, y1);
    up(x1, y1);
    await waitFor(() => expect(useApp.getState().selection?.rows).toEqual(C.rows));
  });

  it("a band (no real extent across X) selects the X range alone, and stays painted across the whole plot", async () => {
    const { result } = renderHook(() => usePlotStageActions({ current: null }, payload, ds, undefined, [0]));
    const u = await mount({ tool: "select", onRangeSelect: result.current.onRangeSelect });
    const c = corners(u);
    const mid = (c.left + c.right) / 2;
    down(u, mid, c.top);
    move(mid + 1, c.bottom);
    up(mid + 1, c.bottom);
    const inBand = C.x.flatMap((v, i) => (v >= C.box.x[0] && v <= C.box.x[1] ? [i] : []));
    await waitFor(() => expect(useApp.getState().selection?.rows).toEqual(inBand));
    expect(u.select.width).toBe(u.over.clientWidth); // painted across the plot's full width
  });

  it("the data slicer reads the painted box back in data coordinates (the filter's X and Y window)", async () => {
    const u = await mount({ tool: "select", onRangeSelect: vi.fn() });
    const c = corners(u);
    down(u, c.left, c.top);
    move(c.right, c.bottom);
    up(c.right, c.bottom);
    const box = sliceBoxOf(u, false)!;
    const [x, y] = [[...box.x].sort((a, b) => a - b), [...box.y!].sort((a, b) => a - b)];
    expect(x[0]).toBeCloseTo(C.box.x[0], 6);
    expect(x[1]).toBeCloseTo(C.box.x[1], 6);
    expect(y[0]).toBeCloseTo(C.box.y[0], 6);
    expect(y[1]).toBeCloseTo(C.box.y[1], 6);
  });
});

describe("Region on a turned plot", () => {
  it("reads its x range up the side and its y range along the bottom", async () => {
    const onRegionSelect = vi.fn();
    const u = await mount({ tool: "region", onRegionSelect });
    const c = corners(u);
    down(u, c.left, c.top);
    move(c.right, c.bottom);
    up(c.right, c.bottom);
    const [x0, x1, y0, y1] = onRegionSelect.mock.calls[0] as number[];
    expect([Math.min(x0, x1), Math.max(x0, x1)]).toEqual([expect.closeTo(C.box.x[0], 6), expect.closeTo(C.box.x[1], 6)]);
    expect([Math.min(y0, y1), Math.max(y0, y1)]).toEqual([expect.closeTo(C.box.y[0], 6), expect.closeTo(C.box.y[1], 6)]);
  });
});

describe("Lasso mask on a turned plot", () => {
  it("an outline round the box masks the rows numpy finds inside it, and Shift unmasks them", async () => {
    const { result } = renderHook(() => usePlotStageActions({ current: null }, payload, ds, undefined, [0]));
    let u = await mount({ tool: "lasso", onLasso: result.current.onLasso });
    let c = corners(u);
    const edge = (ax: number, ay: number, bx: number, by: number) => {
      for (let k = 1; k <= 8; k++) move(ax + ((bx - ax) * k) / 8, ay + ((by - ay) * k) / 8);
    };
    const outline = (shift: boolean) => {
      down(u, c.left, c.top);
      edge(c.left, c.top, c.right, c.top);
      edge(c.right, c.top, c.right, c.bottom);
      edge(c.right, c.bottom, c.left, c.bottom);
      edge(c.left, c.bottom, c.left, c.top + 8);
      up(c.left, c.top + 8, shift);
    };
    outline(false);
    await waitFor(() => expect(useApp.getState().datasets[0].excludedRows).toEqual(C.rows));
    // The app rebuilds the plot on the changed sheet: a second plot, with the actions of the sheet as it is now.
    const fresh = renderHook(() => usePlotStageActions({ current: null }, payload, useApp.getState().datasets[0], undefined, [0]));
    u = await mount({ tool: "lasso", onLasso: fresh.result.current.onLasso });
    c = corners(u);
    outline(true); // Shift: the same outline unmasks them again
    await waitFor(() => expect(useApp.getState().datasets[0].excludedRows ?? []).toEqual([]));
  });

  it("keeps the lasso's outline out of the turned view: it is drawn in plot-area px, not in the upright frame", () => {
    const lasso = lassoPlugin(vi.fn(), "#fff");
    const [kept] = turnPlugins([lasso]);
    expect(kept).toBe(lasso);
  });
});

describe("Pick points on a turned plot", () => {
  it("a click on a point picks that row's own X and Y", async () => {
    const { result } = renderHook(() => usePlotStageActions({ current: null }, payload, ds, undefined, [0]));
    const spy = vi.fn(result.current.onPick);
    const u = await mount({ tool: "pick", onPick: spy });
    const row = 25;
    const [px, py] = [u.valToPos(C.y[row], "y"), u.valToPos(C.x[row], "x")]; // horizontal = Y, vertical = X
    // A real click is a press and a release in place, then the click (uPlot swallows a click after a drag).
    const [cx, cy] = [px + 2, py - 1];
    down(u, cx, cy);
    up(cx, cy);
    u.over.dispatchEvent(new MouseEvent("click", { button: 0, clientX: cx, clientY: cy, bubbles: true }));
    expect(spy).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(usePickedPoints.getState().points).toHaveLength(1));
    const p = usePickedPoints.getState().points[0];
    expect([p.row, p.x, p.y]).toEqual([row, C.x[row], C.y[row]]);
  });
});
