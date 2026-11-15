// The export half of Origin-style multiple Y axes (gap audit 4 G11): the
// figure request's `y_axes` field (routes/export_figures_multi_y.py), built
// from the SAME `resolveExtraYAxes` the canvas draws with (lib/multiY.ts).

import { axisFmtParam, type AxisFormat, type AxisScale } from "./types";
import { resolveExtraYAxes, type ExtraYAxis, type ResolvedExtraY } from "./multiY";
import { sharedAxisTitle } from "./sharedAxisTitle";
import { withUnit } from "./unitDisplay";

/** One `y_axes` entry. */
export interface ExtraYAxisWire {
  keys: number[];
  label?: string;
  scale: AxisScale;
  fmt?: AxisFormat;
  step?: number;
  lim?: [number, number];
  color?: string;
}

/** The title the canvas derives for an extra axis with none of its own:
 *  one series -> its legend name, several -> their shared title
 *  (`uplotOpts`' `soloLabel` over `sharedAxisTitle.drawnOnAxis`). */
export function extraAxisTitle(
  a: ResolvedExtraY,
  data: { labels: readonly string[]; units: readonly string[] },
  renames: Readonly<Record<number, string>>,
): string | undefined {
  if (a.label !== null) return a.label;
  if (a.keys.length === 1) return renames[a.keys[0]] ?? withUnit(data.labels[a.keys[0]], data.units[a.keys[0]] ?? "");
  return sharedAxisTitle(a.keys.map((k) => ({ label: data.labels[k], unit: data.units[k] ?? "" })));
}

export interface ExportMultiY {
  axes: ResolvedExtraY[];
  /** Channels an extra axis takes: never also sent as `y2_keys`. */
  taken: Set<number>;
  wire: ExtraYAxisWire[] | undefined;
  /** Some extra axis is log (the export's minor-tick flag). */
  log: boolean;
}

/** The export's Y3+ axes over the DRAWN `plotted` list; none when `blocked`
 *  (the views the canvas draws no Y3+ axis in -- lib/multiY.ts). */
export function exportExtraYAxes(
  view: { yAxes: ExtraYAxis[]; yAxisOf: Record<number, number>; yScale: AxisScale; yFmt: AxisFormat; seriesLabels: Record<number, string> },
  plotted: readonly number[],
  data: { labels: readonly string[]; units: readonly string[] },
  blocked: boolean,
): ExportMultiY {
  const axes = blocked ? [] : resolveExtraYAxes(plotted, view, { scale: view.yScale, fmt: view.yFmt }).axes;
  const wire = axes.map((a): ExtraYAxisWire => {
    const label = extraAxisTitle(a, data, view.seriesLabels);
    const fmt = axisFmtParam(a.fmt);
    return {
      keys: a.keys, scale: a.scale,
      ...(label ? { label } : {}), ...(fmt ? { fmt } : {}), ...(a.step ? { step: a.step } : {}),
      ...(a.lim ? { lim: a.lim } : {}), ...(a.color ? { color: a.color } : {}),
    };
  });
  return { axes, taken: new Set(axes.flatMap((a) => a.keys)), wire: wire.length ? wire : undefined, log: axes.some((a) => a.scale === "log") };
}
