// Test fixture (UX-A): a stand-in uPlot over a 100×100 px plot area at client
// (50, 20) inside a 200×160 chart root at (0, 0), inside a `.qzk-stage`. Two
// curves over x = 0..10: series 1 rises (y = x), series 2 falls (y = 10 - x).
// `valToPos` / `posToVal` honour the live scale window (`u.scales`), as
// uPlot's do, so a test zooms by setting `scales.x.min/max`. At the default
// window (0..10 on both) that is 10 px per unit. `turned` lays x up the plot
// and y across it (a horizontal-bar plot, x `ori: 1`).

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

export interface FakePlotOpts {
  /** Each series' line width (0 = markers only). */
  widths?: [number, number];
  turned?: boolean;
  /** Replace the two curves: [x, ...series columns]. */
  data?: number[][];
}

/** Build the fake plot and attach its stage to `document.body`. */
export function makeFakePlot(opts: FakePlotOpts = {}): FakePlot {
  const widths = opts.widths ?? [1.5, 1.5];
  const turned = opts.turned ?? false;
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
  axisX.getBoundingClientRect = () => rect(0, 0, 0, 0);
  const xs = Array.from({ length: 11 }, (_, i) => i);
  const scales: Record<string, { min: number; max: number; ori: number }> = {
    x: { min: 0, max: 10, ori: turned ? 1 : 0 },
    y: { min: 0, max: 10, ori: turned ? 0 : 1 },
  };
  const frac = (v: number, k: string) => {
    const s = scales[k] ?? { min: 0, max: 10 };
    return (v - s.min) / (s.max - s.min);
  };
  // Horizontal scales grow rightward; vertical ones grow upward.
  const horizontal = (k: string) => (k === "x") !== turned;
  const u = {
    root,
    over,
    scales,
    data: opts.data ?? [xs, xs.map((x) => x), xs.map((x) => 10 - x)],
    series: [{}, { scale: "y", show: true, width: widths[0] }, { scale: "y", show: true, width: widths[1] }],
    valToPos: (v: number, k: string) => (horizontal(k) ? frac(v, k) * 100 : (1 - frac(v, k)) * 100),
    posToVal: (p: number, k: string) => {
      const s = scales[k] ?? { min: 0, max: 10 };
      const f = horizontal(k) ? p / 100 : 1 - p / 100;
      return s.min + f * (s.max - s.min);
    },
  } as unknown as uPlot;
  return { u, stage, over, root, axisX, legend };
}
