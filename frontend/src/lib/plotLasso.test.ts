// Gap audit 4 G19: the Lasso Mask tool. A free-form outline (screen px) takes
// the rows with a drawn point inside it -- on each point's own axis, so a Y2
// curve is hit where it is drawn, and on a non-monotonic X (an M-H loop) by
// position, not by X order. A reduced payload is traced to its true source
// rows through the row map, or refused. The mask is ONE undo step.

import type uPlot from "uplot";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PlotPayload } from "./plotdata";
import { insidePolygon, lassoRows, rowsInPolygon, type ToPx } from "./plotPointMask";
import { lassoMask } from "./plotLassoMask";
import { excludedSet } from "./rowstate";
import type { Dataset } from "./types";
import { lassoPlugin } from "./uplotLasso";
import { useApp } from "../store/useApp";

/** x and y map 1:1 to px (y up, plot 100 px tall); y2 is 10x compressed. */
const toPx: ToPx = (x, y, axis) => [x, 100 - (axis === 1 ? y / 10 : y)];
const square = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

describe("point in polygon", () => {
  it("is even-odd on a concave outline", () => {
    // A "U": the notch at (50, 20) is outside.
    const u: [number, number][] = [[0, 0], [100, 0], [100, 100], [70, 100], [70, 20], [30, 20], [30, 100], [0, 100]];
    expect(insidePolygon(u, 10, 50)).toBe(true);
    expect(insidePolygon(u, 50, 50)).toBe(false);
    expect(insidePolygon(u, 50, 10)).toBe(true);
  });
});

describe("rowsInPolygon", () => {
  const series = [{ label: "a", unit: "" }, { label: "b", unit: "", axis: 1 }];

  it("tests a Y2 curve where it is drawn, on its own scale", () => {
    const xs = [10, 20, 30];
    const left = [90, 90, 90]; // drawn at py 10
    const right = [500, 500, 900]; // drawn at py 50, 50, 10
    // Around py 40..60 only the y2 points of rows 0 and 1.
    expect(rowsInPolygon([xs, left, right], series, 2, square(0, 40, 40, 60), toPx)).toEqual([0, 1]);
  });

  it("hands a Y3+ curve's own axis number to the pixel mapper (gap audit 4 G11)", () => {
    const seen: number[] = [];
    const spy: ToPx = (x, y, axis) => {
      seen.push(axis);
      return [x, y];
    };
    rowsInPolygon([[1], [2], [3]], [{ label: "a", unit: "" }, { label: "c", unit: "", axis: 2 }], 2, square(50, 50, 60, 60), spy);
    expect(seen).toEqual([0, 2]);
  });

  it("takes points on a non-monotonic X (a loop) by position, not by X order", () => {
    // Up branch at y = 20, down branch at y = 80, same X values.
    const xs = [10, 20, 30, 30, 20, 10];
    const ys = [20, 20, 20, 80, 80, 80];
    // A lasso around the DOWN branch only (py = 100 - 80 = 20).
    expect(rowsInPolygon([xs, ys], [series[0]], 1, square(0, 10, 40, 30), toPx)).toEqual([3, 4, 5]);
  });
});

describe("lassoRows on a reduced payload", () => {
  const N = 1000;
  const ds: Dataset = { id: "d", name: "d", data: { time: Array.from({ length: N }, (_, r) => r / 10), values: Array.from({ length: N }, (_, r) => [r === 555 ? 95 : 10]), labels: ["M"], units: [""], metadata: {} } };
  const ids = Array.from({ length: N }, (_, r) => r).filter((r) => r % 100 === 0 || r === 555);
  const payload: PlotPayload = {
    data: [ids.map((r) => r / 10), ids.map((r) => ds.data.values[r][0])],
    series: [{ label: "M", unit: "" }],
    xLabel: "t",
    xUnit: "",
    rowIds: ids,
    decimated: true,
  } as PlotPayload;

  it("masks the TRUE source rows, including points decimation did not draw", () => {
    // Every row from x = 20 to 30 at y = 10 (py 90), plus nothing else.
    const got = lassoRows(payload, [0], ds, null, square(19.95, 85, 30.05, 95), toPx);
    expect(got).toEqual({ rows: Array.from({ length: 101 }, (_, i) => 200 + i) });
    // The outlier, drawn at its true row 555.
    expect(lassoRows(payload, [0], ds, null, square(50, 0, 60, 10), toPx)).toEqual({ rows: [555] });
  });

  it("refuses a payload whose drawn rows cannot be traced", () => {
    const lying = { ...payload, rowIds: ids.map((r) => r + 1) };
    expect(lassoRows(lying, [0], ds, null, square(0, 0, 100, 100), toPx)).toHaveProperty("refused");
    const untraced = { ...payload, rowIds: undefined };
    expect(lassoRows(untraced, [0], ds, null, square(0, 0, 100, 100), toPx)).toHaveProperty("refused");
  });
});

const ORIGINAL_STATE = useApp.getState();

describe("lassoMask: one undo step", () => {
  const ORIGINAL = ORIGINAL_STATE;
  afterEach(() => useApp.setState(ORIGINAL, true));

  it("masks the enclosed points, Shift unmasks them, and undo restores", () => {
    const ds: Dataset = { id: "d", name: "d", data: { time: [10, 20, 30, 40], values: [[10], [20], [30], [40]], labels: ["y"], units: [""], metadata: {} } };
    useApp.setState({ datasets: [ds], activeId: "d", xKey: null, history: [], future: [] });
    const payload = { data: [[10, 20, 30, 40], [10, 20, 30, 40]], series: [{ label: "y", unit: "" }], xLabel: "x", xUnit: "" } as PlotPayload;
    const u = { valToPos: (v: number, k: string) => (k === "x" ? v : 100 - v), bbox: { left: 0, top: 0, width: 100, height: 100 } } as unknown as uPlot;
    lassoMask(u, payload, [0], ds, square(15, 60, 35, 85), false);
    const st = useApp.getState();
    expect([...excludedSet(st.datasets[0])].sort()).toEqual([1, 2]);
    expect(st.history).toHaveLength(1);
    lassoMask(u, payload, [0], st.datasets[0], square(15, 75, 25, 85), true);
    expect([...excludedSet(useApp.getState().datasets[0])]).toEqual([2]);
    useApp.getState().undo();
    expect([...excludedSet(useApp.getState().datasets[0])].sort()).toEqual([1, 2]);
    useApp.getState().undo();
    expect(excludedSet(useApp.getState().datasets[0]).size).toBe(0);
  });
});

describe("lassoPlugin", () => {
  it("hands back the drawn outline on release, with Shift as unmask; Escape-free release of a click does nothing", () => {
    const over = document.createElement("div");
    over.getBoundingClientRect = () => ({ left: 100, top: 50, right: 500, bottom: 350, width: 400, height: 300, x: 100, y: 50, toJSON: () => ({}) });
    const onLasso = vi.fn();
    const plugin = lassoPlugin(onLasso, "#f00");
    const u = { over, redraw: vi.fn() } as unknown as uPlot;
    (plugin.hooks.ready as (u: uPlot) => void)(u);
    const at = (type: string, x: number, y: number, shiftKey = false) => new MouseEvent(type, { clientX: x, clientY: y, button: 0, shiftKey, bubbles: true });
    over.dispatchEvent(at("mousedown", 110, 60));
    document.dispatchEvent(at("mousemove", 200, 60));
    document.dispatchEvent(at("mousemove", 200, 160));
    document.dispatchEvent(at("mouseup", 200, 160, true));
    expect(onLasso).toHaveBeenCalledTimes(1);
    expect(onLasso.mock.calls[0][1]).toEqual([[10, 10], [100, 10], [100, 110]]);
    expect(onLasso.mock.calls[0][2]).toBe(true);
    // A click (no outline) masks nothing.
    over.dispatchEvent(at("mousedown", 110, 60));
    document.dispatchEvent(at("mouseup", 110, 60));
    expect(onLasso).toHaveBeenCalledTimes(1);
  });
});

// Gap audit 4 G19 review: the outline is clamped to the plotting area and a
// point drawn off it is never hit (M3); the non-zero winding rule (L1).
describe("lasso review fixes", () => {
  it("never masks a point drawn off the plotting area", () => {
    const ds: Dataset = { id: "d", name: "d", data: { time: [50, 150], values: [[50], [50]], labels: ["y"], units: [""], metadata: {} } };
    useApp.setState({ datasets: [ds], activeId: "d", xKey: null, history: [], future: [] });
    const payload = { data: [[50, 150], [50, 50]], series: [{ label: "y", unit: "" }], xLabel: "x", xUnit: "" } as PlotPayload;
    // Zoomed so x in [0, 100] fills a 100 px plot: row 1 sits at px 150, off it.
    const u = { valToPos: (v: number, k: string) => (k === "x" ? v : 100 - v), bbox: { left: 0, top: 0, width: 100, height: 100 } } as unknown as uPlot;
    lassoMask(u, payload, [0], ds, [[90, 40], [200, 40], [200, 60], [90, 60]], false);
    expect(useApp.getState().datasets[0].excludedRows ?? []).toEqual([]);
    lassoMask(u, payload, [0], ds, [[40, 40], [200, 40], [200, 60], [40, 60]], false);
    expect(useApp.getState().datasets[0].excludedRows).toEqual([0]);
    useApp.setState(ORIGINAL_STATE, true);
  });

  it("clamps the drawn outline to the plotting area", () => {
    const over = document.createElement("div");
    over.getBoundingClientRect = () => ({ left: 100, top: 50, right: 500, bottom: 350, width: 400, height: 300, x: 100, y: 50, toJSON: () => ({}) });
    const onLasso = vi.fn();
    (lassoPlugin(onLasso, "#f00").hooks.ready as (u: uPlot) => void)({ over, redraw: vi.fn() } as unknown as uPlot);
    const at = (type: string, x: number, y: number) => new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true });
    over.dispatchEvent(at("mousedown", 110, 60));
    document.dispatchEvent(at("mousemove", 900, 60));
    document.dispatchEvent(at("mousemove", 900, 900));
    document.dispatchEvent(at("mouseup", 900, 900));
    expect(onLasso.mock.calls[0][1]).toEqual([[10, 10], [400, 10], [400, 300]]);
  });

  it("an outline traced round twice still encloses its inside (non-zero winding)", () => {
    const sq: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(insidePolygon([...sq, ...sq], 5, 5)).toBe(true);
    expect(insidePolygon([...sq, ...sq], 15, 5)).toBe(false);
  });
});
