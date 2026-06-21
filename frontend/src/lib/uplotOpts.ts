// Build uPlot options from live design tokens, so the plot restyles for free
// when theme/accent change. The plot canvas stays dark in both themes.

import type uPlot from "uplot";

import type { PlotPayload } from "./plotdata";

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

export function buildOpts(
  payload: PlotPayload,
  width: number,
  height: number,
  yLog: boolean,
): uPlot.Options {
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

  return {
    width,
    height,
    cursor: { drag: { x: true, y: true, uni: 1 } },
    legend: { show: false },
    scales: { y: { distr: yLog ? 3 : 1 } },
    axes: [
      { ...axis, label: xLabel },
      { ...axis, size: 60 },
    ],
    series: [
      {},
      ...payload.series.map((s, i) => ({
        label: s.unit ? `${s.label} (${s.unit})` : s.label,
        stroke: cssVar(SERIES_VARS[i % SERIES_VARS.length]) || "#8b5cf6",
        width: 1.5,
        points: { show: false },
      })),
    ],
  };
}
