// The Stat Stage's one-sample draws (Q-Q, histogram, CDF): which backend call
// each mode makes for the picked column(s), and the rug stamped on afterwards.
// Moved out of `useStatStage.ts` (its 500-line ceiling) when the CDF plot joined
// them; behaviour of Q-Q and histogram is unchanged.

import { statsCdf, statsQQ } from "../../lib/api";
import type { CdfY, RugPick } from "../../lib/statCdf";
import { resolveRug } from "../../lib/statCdf";
import { finiteOf } from "../../lib/statstage";
import type { DataStruct } from "../../lib/types";
import type { StatDrawData } from "./statRender";
import { computeHistogramDraw, histogramColumns } from "./statHistMulti";
import { qqDraw } from "./useStatStageCompute";

export interface SampleOpts {
  valueCol: number;
  histCols: readonly number[];
  dist: string;
  bins: string;
  fit: string | null;
  valueLabel: string;
  cdfY: CdfY;
  cdfBand: boolean;
}

/** The CDF plot's draw: one series per picked column that has a finite value
 *  (a column with none has no line to draw); rejects when none does. */
async function computeCdfDraw(data: DataStruct, o: SampleOpts): Promise<StatDrawData> {
  const picked = histogramColumns(o.valueCol, o.histCols, data.labels.length);
  const cols = picked.map((c) => ({ label: data.labels[c] ?? `column ${c}`, values: finiteOf(data, c) }));
  const kept = cols.filter((c) => c.values.length > 0);
  if (!kept.length) throw new Error("need ≥ 1 finite value");
  const wire = await statsCdf(kept.map((c) => c.values), o.cdfY, o.cdfBand, o.fit);
  return { mode: "cdf", wire, labels: kept.map((c) => c.label), columns: kept.map((c) => c.values), valueLabel: o.valueLabel };
}

/** The draw for a one-sample mode; rejects with the reason it cannot draw. */
export async function computeSampleDraw(mode: "qq" | "histogram" | "cdf", data: DataStruct, o: SampleOpts): Promise<StatDrawData> {
  if (mode === "cdf") return computeCdfDraw(data, o);
  if (mode === "qq") {
    const finite = finiteOf(data, o.valueCol);
    if (finite.length < 3) throw new Error("need ≥ 3 finite values");
    return qqDraw(await statsQQ(finite, o.dist), o.valueLabel);
  }
  const cols = histogramColumns(o.valueCol, o.histCols, data.labels.length);
  return computeHistogramDraw(data, cols, cols.map((c) => data.labels[c] ?? ""), o.bins, o.fit, o.valueLabel);
}

/** `draw` with the rug option stamped on (histogram and CDF only; any other
 *  draw is returned as is). Cheap: no refetch when only the rug changes. */
export function withRug(
  draw: StatDrawData | null,
  data: DataStruct | null,
  histCols: readonly number[],
  valueCol: number,
  pick: RugPick | undefined,
): StatDrawData | null {
  const opts = resolveRug(pick);
  if (!draw || !data || (draw.mode !== "histogram" && draw.mode !== "cdf")) return draw;
  if (!opts) return draw.rug ? { ...draw, rug: null } : draw;
  const columns = draw.mode === "cdf"
    ? draw.columns
    : histogramColumns(valueCol, histCols, data.labels.length).map((c) => finiteOf(data, c));
  return { ...draw, rug: { opts, columns } };
}
