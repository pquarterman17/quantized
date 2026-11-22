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
