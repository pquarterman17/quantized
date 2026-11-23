// Statistical tests: a Kaplan-Meier result as a derived worksheet (the
// "Add curve as worksheet / Add as plot" actions). Pure.
//
// Layout (the long format the batch tools and the CSV export use for a result
// with several groups: one tidy table with a group column, not side-by-side
// blocks that would each need their own time grid):
//   one curve        time | S(t) | 95% CI low | 95% CI high | at risk | events
//   one per group    time | group | S(t) | 95% CI low | 95% CI high | at risk | events
// with the groups stacked in the order the test reported them. The time column
// is the worksheet's X; `group` is a categorical channel (cat_levels). A bound
// the backend left out (null) is NaN, never invented. Values are the backend's
// numbers unchanged, so the sheet equals the "Survival curve and at-risk table"
// shown in the result.

import type { KaplanMeierResult } from "./api/statsTestsSurvival";
import type { DataStruct, SeriesStyle } from "./types";

export interface KmWorksheet {
  data: DataStruct;
  /** Channel indices of S(t) and the CI bounds, and of the group column (-1 when one curve). */
  survival: number;
  ciLow: number;
  ciHigh: number;
  groupChannel: number;
}

const val = (v: number | null | undefined): number => (typeof v === "number" ? v : NaN);

export function kaplanMeierWorksheet(result: KaplanMeierResult, timeLabel: string, timeUnit: string): KmWorksheet {
  const grouped = !(result.groups.length === 1 && result.groups[0]!.label === "");
  const time: number[] = [];
  const values: number[][] = [];
  result.groups.forEach((g, gi) => {
    const c = g.curve;
    c.times.forEach((t, i) => {
      time.push(val(t));
      const row = [val(c.survival[i]), val(c.ciLow[i]), val(c.ciHigh[i]), val(c.atRisk[i]), val(c.events[i])];
      values.push(grouped ? [gi, ...row] : row);
    });
  });
  const body = ["S(t)", "95% CI low", "95% CI high", "at risk", "events"];
  const off = grouped ? 1 : 0;
  const labels = grouped ? ["group", ...body] : body;
  const data: DataStruct = {
    time,
    values,
    labels,
    units: labels.map(() => ""),
    metadata: { x_column_name: timeLabel, x_unit: timeUnit, source: "kaplan-meier" },
    ...(grouped ? { cat_levels: { 0: result.groups.map((g) => g.label) } } : {}),
  };
  return { data, survival: off, ciLow: off + 1, ciHigh: off + 2, groupChannel: grouped ? 0 : -1 };
}

/** The plot view for the curve: S(t) as a right-continuous step (a KM curve
 *  holds its value until the next event time), the CI bounds as dashed steps
 *  of the same colour. One curve per group plots S(t) split by the group column
 *  (the bounds of several groups would triple the series; they stay in the sheet). */
export function kaplanMeierPlotView(w: KmWorksheet): { yKeys: number[]; groupKey: number | null; seriesStyles: Record<number, SeriesStyle> } {
  const main: SeriesStyle = { step: "post", width: 2 };
  if (w.groupChannel >= 0) return { yKeys: [w.survival], groupKey: w.groupChannel, seriesStyles: { [w.survival]: main } };
  const band: SeriesStyle = { step: "post", width: 1, line: "dashed", color: "--series-1" };
  return {
    yKeys: [w.survival, w.ciLow, w.ciHigh],
    groupKey: null,
    seriesStyles: { [w.survival]: { ...main, color: "--series-1" }, [w.ciLow]: band, [w.ciHigh]: { ...band } },
  };
}
