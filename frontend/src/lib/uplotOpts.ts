// Build uPlot options from live design tokens, so the plot restyles for free
// when theme/accent change. The plot canvas stays dark in both themes.

import type uPlot from "uplot";

import type { PlotPayload } from "./plotdata";
import { panPlugin, readoutPlugin, type Readout } from "./uplotPlugins";

export type PlotTool = "zoom" | "pan" | "cursor";

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const SERIES_VARS = [
  "--series-1",
  "--series-2",
  "--series-3",
  "--series-4",
  "--series-5",
  "--series-6",
  "--series-7",
  "--series-8",
];

export interface BuildOptsArgs {
  width: number;
  height: number;
  yLog: boolean;
  xLog: boolean;
  tool: PlotTool;
  onReadout: (r: Readout | null) => void;
}

export function buildOpts(payload: PlotPayload, args: BuildOptsArgs): uPlot.Options {
  const { width, height, yLog, xLog, tool, onReadout } = args;
  const axisColor = cssVar("--text-dim") || "#aaa";
  const gridColor = cssVar("--grid-line") || "#333";
  const font = `11px ${cssVar("--font-mono") || "monospace"}`;
  const xLabel = payload.xUnit ? `${payload.xLabel} (${payload.xUnit})` : payload.xLabel;

  const axis = {
    stroke: axisColor,
    font,
    grid: { stroke: gridColor, width: 1 },
    ticks: { stroke: gridColor, width: 1 },
  };

  const plugins: uPlot.Plugin[] = [];
  if (tool === "pan") plugins.push(panPlugin());
  if (tool === "cursor") plugins.push(readoutPlugin(onReadout));

  return {
    width,
    height,
    // Box-zoom only in zoom mode; pan/cursor disable drag-zoom.
    cursor: { drag: { x: tool === "zoom", y: tool === "zoom", uni: 1 } },
    plugins,
    legend: { show: false },
    scales: { x: { distr: xLog ? 3 : 1 }, y: { distr: yLog ? 3 : 1 } },
    axes: [
      { ...axis, label: xLabel },
      { ...axis, size: 60 },
    ],
    series: [
      {},
      ...payload.series.map((s, i) => {
        const stroke = cssVar(SERIES_VARS[i % SERIES_VARS.length]) || "#8b5cf6";
        const label = s.unit ? `${s.label} (${s.unit})` : s.label;
        // Peak markers: points only, no connecting line.
        if (s.kind === "points") {
          return { label, stroke, fill: stroke, width: 0, points: { show: true, size: 8 } };
        }
        return { label, stroke, width: 1.5, points: { show: false } };
      }),
    ],
  };
}
