// Test fixture (UX-A): a stand-in uPlot over a 100×100 px plot area at client
// (50, 20) inside a 200×160 chart root at (0, 0), inside a `.qzk-stage`. Two
// curves over x = 0..10: series 1 rises (y = x), series 2 falls (y = 10 - x).
// Data units map 10 px per unit on both axes.

import type uPlot from "uplot";

export const OVER = { left: 50, top: 20, width: 100, height: 100 };

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

export interface FakePlot {
  u: uPlot;
  stage: HTMLDivElement;
  over: HTMLDivElement;
  root: HTMLDivElement;
  axisX: HTMLDivElement;
  legend: HTMLDivElement;
}

/** Build the fake plot and attach its stage to `document.body`. `widths` sets
 *  each series' line width (0 = markers only). */
export function makeFakePlot(widths: [number, number] = [1.5, 1.5]): FakePlot {
  const stage = document.createElement("div");
  stage.className = "qzk-stage";
  const root = document.createElement("div");
  root.className = "uplot";
  const over = document.createElement("div");
  over.className = "u-over";
  const axisX = document.createElement("div");
  axisX.className = "u-axis";
  const legend = document.createElement("div");
  legend.className = "qzk-glass qzk-legend";
  root.append(over, axisX);
  stage.append(root, legend);
  document.body.append(stage);
  stage.getBoundingClientRect = () => rect(0, 0, 200, 160);
  root.getBoundingClientRect = () => rect(0, 0, 200, 160);
  over.getBoundingClientRect = () => rect(OVER.left, OVER.top, OVER.width, OVER.height);
  legend.getBoundingClientRect = () => rect(120, 30, 25, 15);
  const xs = Array.from({ length: 11 }, (_, i) => i);
  const u = {
    root,
    over,
    data: [xs, xs.map((x) => x), xs.map((x) => 10 - x)],
    series: [{}, { scale: "y", show: true, width: widths[0] }, { scale: "y", show: true, width: widths[1] }],
    valToPos: (v: number, scale: string) => (scale === "x" ? v * 10 : (10 - v) * 10),
    posToVal: (p: number, scale: string) => (scale === "x" ? p / 10 : 10 - p / 10),
  } as unknown as uPlot;
  return { u, stage, over, root, axisX, legend };
}
