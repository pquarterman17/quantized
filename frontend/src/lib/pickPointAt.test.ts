// Item 22: a click on the plot picks the nearest DRAWN data point, through the
// own channel (`pickAt`, apart from the lasso), on the real store path.

import type uPlot from "uplot";
import { beforeEach, describe, expect, it } from "vitest";

import type { PlotPayload } from "./plotdata";
import type { Dataset } from "./types";
import { lassoMask } from "./plotLassoMask";
import { pickAt } from "./pickPointAt";
import { pickMarksPlugin } from "./uplotPickMarks";
import { usePickedPoints } from "../store/pickedPoints";
import { pickedData } from "./pickPoints";
import { useApp } from "../store/useApp";

const ds: Dataset = {
  id: "a", name: "A", data: { time: [0, 1, 2, 3], values: [[5], [6], [7], [8]], labels: ["Y"], units: [""], metadata: {} },
  excludedRows: [3],
};
// 10 px per unit on both axes; y screen = value * 10.
const u = {
  valToPos: (v: number) => v * 10,
  series: [{}, { scale: "y" }],
  scales: { x: { ori: 0 } },
  bbox: { width: 1000, height: 1000 },
} as unknown as uPlot;
const payload = {
  data: [[0, 1, 2, 3], [5, 6, 7, 8]],
  series: [{ label: "Y", unit: "", axis: 0 }],
  xLabel: "X", xUnit: "",
} as unknown as PlotPayload;

beforeEach(() => {
  useApp.setState({ datasets: [ds], activeId: "a", xKey: null, yKeys: [0], hiddenChannels: [], seriesOrder: [], workbooks: [] });
  usePickedPoints.getState().clear();
});

describe("pickAt", () => {
  it("picks the point nearest the click, with its source row and values", () => {
    pickAt(u, payload, [0], ds, [21, 69]); // near (x 2, y 7) -> px (20, 70)
    expect(usePickedPoints.getState().points).toMatchObject([{ datasetId: "a", row: 2, x: 2, y: 7 }]);
  });
  it("names the curve and sheet it picked from in the status", () => {
    pickAt(u, payload, [0], ds, [21, 69]);
    expect(useApp.getState().status).toBe("picked point 1 from Y of A: X = 2, Y = 7");
  });
  it("says it snapped to the nearest of several plotted curves", () => {
    const two = {
      data: [[0, 1, 2, 3], [5, 6, 7, 8], [50, 60, 70, 80]],
      series: [{ label: "Y", unit: "", axis: 0 }, { label: "Y", unit: "", axis: 0 }],
      xLabel: "X", xUnit: "",
    } as unknown as PlotPayload;
    const ds2: Dataset = { ...ds, data: { ...ds.data, values: [[5, 50], [6, 60], [7, 70], [8, 80]], labels: ["Y", "Z"], units: ["", ""] } };
    useApp.setState({ datasets: [ds2], yKeys: [0, 1] });
    pickAt({ ...u, series: [{}, { scale: "y" }, { scale: "y" }] } as unknown as uPlot, two, [0, 1], ds2, [21, 69]);
    expect(useApp.getState().status).toBe("picked point 1 from Y of A, the nearest of 2 plotted curves: X = 2, Y = 7");
  });
  it("picks nothing far from every point, and a repeat adds nothing", () => {
    pickAt(u, payload, [0], ds, [500, 500]);
    expect(usePickedPoints.getState().points).toHaveLength(0);
    pickAt(u, payload, [0], ds, [20, 70]);
    pickAt(u, payload, [0], ds, [20, 70]);
    expect(usePickedPoints.getState().points).toHaveLength(1);
  });
  it("refuses a masked point", () => {
    pickAt(u, payload, [0], ds, [30, 80]); // row 3 is excluded
    expect(usePickedPoints.getState().points).toHaveLength(0);
  });
  it("a real lasso (3+ vertices) masks and picks nothing", () => {
    lassoMask(u, payload, [0], ds, [[0, 0], [100, 0], [100, 100], [0, 100]], false);
    expect(usePickedPoints.getState().points).toHaveLength(0);
  });
  it("a one-vertex outline given to the lasso does nothing: a click is not a lasso", () => {
    lassoMask(u, payload, [0], ds, [[21, 69]], false);
    expect(usePickedPoints.getState().points).toHaveLength(0);
    expect(useApp.getState().datasets[0].excludedRows).toEqual([3]);
  });
});

// A pick, then a lasso, then a pick, through the real store: no state leaks either way.
describe("pick, lasso, pick", () => {
  it("leaves no lasso or selection state behind a pick, and no pick behind a lasso", () => {
    const cur = () => useApp.getState().datasets[0]; // fresh each time: the store replaces the dataset
    const picked = () => usePickedPoints.getState().points.map((p) => p.row);
    const box: [number, number][] = [[-5, 45], [15, 45], [15, 65], [-5, 65]]; // encloses rows 0 and 1 (px (0,50), (10,60))
    const h0 = useApp.getState().history.length;
    const sel0 = useApp.getState().selectedIds;

    pickAt(u, payload, [0], cur(), [20, 70]); // row 2
    expect(picked()).toEqual([2]);
    expect(cur().excludedRows).toEqual([3]); // the pick masked nothing
    expect(useApp.getState().history.length).toBe(h0); // and made no undo step
    expect(useApp.getState().selectedIds).toEqual(sel0);

    lassoMask(u, payload, [0], cur(), box, false);
    expect(cur().excludedRows).toEqual([0, 1, 3]); // the lasso masked its rows
    expect(picked()).toEqual([2]); // and left the pick list alone

    pickAt(u, payload, [0], cur(), [10, 60]); // row 1 is masked now: refused, nothing added
    expect(picked()).toEqual([2]);
    expect(cur().excludedRows).toEqual([0, 1, 3]);

    lassoMask(u, payload, [0], cur(), box, true); // Shift: unmask them
    expect(cur().excludedRows).toEqual([3]);
    pickAt(u, payload, [0], cur(), [10, 60]); // row 1 picks now
    expect(picked()).toEqual([2, 1]);
    expect(cur().excludedRows).toEqual([3]); // the pick still masks nothing
  });
});

describe("pick markers", () => {
  const over = () => {
    const el = document.createElement("div");
    Object.defineProperty(el, "clientWidth", { value: 1000 });
    Object.defineProperty(el, "clientHeight", { value: 1000 });
    return el;
  };
  it("mark each picked point on the plot, stay with the list, clear with it, and live in the DOM (not the canvas)", () => {
    const el = over();
    const mu = { ...u, over: el, scales: { x: { ori: 0 }, y: {} } } as unknown as uPlot;
    const plugin = pickMarksPlugin();
    (plugin.hooks.ready as (u: uPlot) => void)(mu);
    expect(el.querySelectorAll("[data-pick-mark]")).toHaveLength(0);
    pickAt(u, payload, [0], ds, [20, 70]); // row 2: drawn at (2, 7) -> (20, 70)
    pickAt(u, payload, [0], ds, [10, 60]); // row 1
    const marks = [...el.querySelectorAll<HTMLElement>("[data-pick-mark]")];
    expect(marks.map((m) => m.textContent)).toEqual(["1", "2"]);
    expect(marks[0].style.left).toBe("10px"); // 20 - 10
    expect(marks[0].style.top).toBe("60px"); // 70 - 10
    // The tool being switched changes nothing: the list is what keeps them.
    useApp.getState().setPlotTool("zoom");
    expect(el.querySelectorAll("[data-pick-mark]")).toHaveLength(2);
    usePickedPoints.getState().removeAt(0);
    expect([...el.querySelectorAll("[data-pick-mark]")].map((m) => m.textContent)).toEqual(["1"]);
    usePickedPoints.getState().clear();
    expect(el.querySelectorAll("[data-pick-mark]")).toHaveLength(0);
    (plugin.hooks.destroy as (u: uPlot) => void)(mu);
    expect(el.querySelector("[data-pick-marks]")).toBeNull();
  });
  it("draw a ring big enough for a two-digit number, with that number haloed in the plot's own colours (acceptance 5 C5)", () => {
    const el = over();
    const mu = { ...u, over: el, scales: { x: { ori: 0 }, y: {} } } as unknown as uPlot;
    (pickMarksPlugin().hooks.ready as (u: uPlot) => void)(mu);
    pickAt(u, payload, [0], ds, [20, 70]);
    const m = el.querySelector<HTMLElement>("[data-pick-mark]")!;
    expect(parseFloat(m.style.width)).toBeGreaterThanOrEqual(18);
    expect(parseFloat(m.style.font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? "0")).toBeGreaterThanOrEqual(11);
    // Dark fallback plot (no CSS in the test): light ink, dark halo; the ring carries the halo too.
    expect(m.style.textShadow).toContain("rgb(19, 19, 26)");
    expect(m.style.color).not.toBe("");
    expect(m.style.boxShadow).toContain("rgb(19, 19, 26)");
    document.documentElement.dataset.theme = "light";
    usePickedPoints.getState().add({ ...usePickedPoints.getState().points[0], row: 9 }); // any change repaints
    expect(el.querySelector<HTMLElement>("[data-pick-mark]")!.style.textShadow).toContain("rgb(247, 247, 250)");
    document.documentElement.removeAttribute("data-theme");
  });
  it("show only on the graph the points were picked from, and skip a point panned out of view", () => {
    const el = over();
    const mu = { ...u, over: el, scales: { x: { ori: 0 }, y: {} } } as unknown as uPlot;
    (pickMarksPlugin().hooks.ready as (u: uPlot) => void)(mu);
    pickAt(u, payload, [0], ds, [20, 70]);
    expect(el.querySelectorAll("[data-pick-mark]")).toHaveLength(1);
    useApp.setState({ activeId: "other" });
    usePickedPoints.getState().add({ ...usePickedPoints.getState().points[0], row: 9 }); // any change repaints
    expect(el.querySelectorAll("[data-pick-mark]")).toHaveLength(0);
    useApp.setState({ activeId: "a" });
    usePickedPoints.getState().clear();
    pickAt(u, payload, [0], ds, [20, 70]);
    const small = { ...mu, valToPos: (v: number) => v * 1000 } as unknown as uPlot; // the point is now far outside a 1000 px plot
    (pickMarksPlugin().hooks.ready as (u: uPlot) => void)({ ...small, over: over() } as uPlot);
    expect(el.querySelectorAll("[data-pick-mark]")).toHaveLength(1);
  });
  it("draw a point picked from a Y2 curve against y2, not y, and skip it when y2 is gone", () => {
    const el = over();
    // Y1 10 px per unit; Y2 0.1 px per unit (the curve on it runs 0..1000).
    const px = (v: number, scale: string) => (scale === "y2" ? v / 10 : v * 10);
    const y2u = { ...u, series: [{}, { scale: "y" }, { scale: "y2" }], valToPos: px, scales: { x: { ori: 0 }, y: {}, y2: {} } } as unknown as uPlot;
    const both = { data: [[0, 1, 2, 3], [5, 6, 7, 8], [500, 600, 700, 800]], series: [{ label: "Y", unit: "", axis: 0 }, { label: "T", unit: "", axis: 1 }], xLabel: "X", xUnit: "" } as unknown as PlotPayload;
    const two = { ...ds, data: { ...ds.data, values: [[5, 500], [6, 600], [7, 700], [8, 800]], labels: ["Y", "T"], units: ["", ""] } };
    useApp.setState({ yKeys: [0, 1], y2Keys: [1], datasets: [two] });
    const plugin = pickMarksPlugin();
    (plugin.hooks.ready as (u: uPlot) => void)({ ...y2u, over: el } as uPlot);
    // Row 1 of the Y2 curve is T = 600: at px (10, 60) on y2, where the Y1 curve (6) would be at 60 on y.
    pickAt(y2u, both, [0, 1], two, [10, 60]);
    expect(usePickedPoints.getState().points[0].mark).toMatchObject({ y: 600, scale: "y2" });
    expect((el.querySelector("[data-pick-mark]") as HTMLElement).style.top).toBe("50px"); // 600 / 10 - 10, not 6000
    // The axis is gone from the plot: no mark, not one against y.
    const p2 = pickMarksPlugin();
    const el2 = over();
    (p2.hooks.ready as (u: uPlot) => void)({ ...y2u, scales: { x: { ori: 0 }, y: {} }, over: el2 } as unknown as uPlot);
    expect(el2.querySelectorAll("[data-pick-mark]")).toHaveLength(0);
    useApp.setState({ y2Keys: null });
  });
  it("carry no mark into the worksheet the picks become", () => {
    pickAt(u, payload, [0], ds, [20, 70]);
    expect(JSON.stringify(pickedData(usePickedPoints.getState().points))).not.toContain("graphId");
  });
});
