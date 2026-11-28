// The Stat Stage's histogram compute, single or multi-column (Origin bins every
// selected Y column in one graph). One column: `/api/statplots/histogram` with
// the optional distribution fit; several: `/api/statplots/histogram-multi`, the
// bin rule run on the pooled values so every column shares its edges (a fit
// is a single-column feature and is not drawn). The export spec for the same
// picks is `multiHistogramSpec` (`calc/figure_hist_multi.py` draws it).
// Split out of `useStatStage.ts` (its 500-line cap).

import { statsHistogram, statsHistogramMulti } from "../../lib/api";
import type { StatplotFigureSpec } from "../../lib/api/figures";
import { finiteOf } from "../../lib/statstage";
import type { GroupSpec } from "../../lib/statschooser";
import type { DataStruct } from "../../lib/types";
import type { StatDrawData } from "./statRender";
import { histogramDraw } from "./useStatStageCompute";

/** The columns a histogram bins: the value column first, then the extra picks
 *  that still exist in this dataset, each once. */
export function histogramColumns(valueCol: number, extra: readonly number[], width: number): number[] {
  const out = [valueCol];
  for (const c of extra) if (c >= 0 && c < width && !out.includes(c)) out.push(c);
  return out;
}

/** The histogram draw for these picks; rejects with the reason it cannot draw. */
export async function computeHistogramDraw(
  data: DataStruct,
  cols: readonly number[],
  labels: readonly string[],
  bins: string,
  fit: string | null,
  valueLabel: string,
): Promise<StatDrawData> {
  if (cols.length < 2) {
    const finite = finiteOf(data, cols[0]);
    if (finite.length < (fit ? 2 : 1)) throw new Error(fit ? "need ≥ 2 finite values" : "need ≥ 1 finite value");
    return histogramDraw(await statsHistogram(finite, bins, fit), fit, valueLabel);
  }
  const columns = cols.map((c) => finiteOf(data, c));
  if (!columns.some((c) => c.length)) throw new Error("need ≥ 1 finite value");
  const r = (await statsHistogramMulti(columns, bins)) as unknown as {
    edges: number[];
    series: { counts: number[] }[];
  };
  const series = r.series.map((s, i) => ({ label: labels[i] ?? `column ${cols[i]}`, counts: s.counts.map(Number) }));
  return {
    mode: "histogram",
    edges: r.edges.map(Number),
    counts: series[0].counts,
    series,
    density: false,
    valueLabel,
  };
}

/** The export request for a several-column histogram (one list per column). */
export function multiHistogramSpec(
  data: DataStruct,
  cols: readonly number[],
  labels: readonly string[],
  bins: string,
  fmt: string,
  valueLabel: string,
): StatplotFigureSpec | null {
  const columns = cols.map((c) => finiteOf(data, c));
  if (!columns.some((c) => c.length)) return null;
  return {
    kind: "histogram",
    data: columns,
    labels: [...labels],
    bins,
    fmt,
    x_label: valueLabel,
    y_label: "count",
    filename: `histogram_${labels.join("_")}`,
  };
}

/** The histogram of one value column split by a group column: a series per group on the
 *  shared bins (the bin rule runs on the pooled values), each group's raw values kept on
 *  the draw for the rug and the export. Needs two groups with a finite value. */
export async function computeGroupHistogramDraw(
  groups: readonly GroupSpec[],
  bins: string,
  valueLabel: string,
  min = 2,
): Promise<StatDrawData> {
  const kept = groups.filter((g) => g.values.length > 0);
  if (kept.length < min) throw new Error(min > 1 ? 'splitting a histogram needs at least 2 "group by" levels with a finite value' : "need ≥ 1 finite value");
  const r = (await statsHistogramMulti(kept.map((g) => g.values), bins)) as unknown as {
    edges: number[];
    series: { counts: number[] }[];
  };
  const series = r.series.map((s, i) => ({ label: kept[i].label, counts: s.counts.map(Number) }));
  return {
    mode: "histogram", edges: r.edges.map(Number), counts: series[0].counts, series, density: false, valueLabel,
    values: kept.map((g) => g.values),
  };
}

/** The stacked-bars part of a histogram export: the `stack` option (and `percent`, which also
 *  retitles the count axis), or nothing for a draw that is not stacked. */
export function stackWire(draw: StatDrawData | null): Partial<StatplotFigureSpec> {
  if (draw?.mode !== "histogram" || !draw.stack) return {};
  return draw.percent ? { dist3: { type: "stack", stack: true, percent: true }, y_label: "percent" } : { dist3: { type: "stack", stack: true } };
}

/** The export request of a group-split histogram draw (null for any other draw). */
export function groupHistogramSpec(draw: StatDrawData | null, bins: string, fmt: string): StatplotFigureSpec | null {
  if (draw?.mode !== "histogram" || !draw.values || !draw.series) return null;
  const labels = draw.series.map((s) => s.label);
  return {
    kind: "histogram", data: draw.values, labels, bins, fmt, x_label: draw.valueLabel, y_label: "count",
    filename: `histogram_${labels.join("_")}`,
  };
}
