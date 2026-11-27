// The Stat Stage's half / split violin, paired and lollipop draws (plan item 20):
// which compute each makes for the picked columns / groups, and the export
// request for the settled draw. Split out of `useStatStage.ts` (its ceiling).
//
// SIDE VIOLIN: one half per group; a split puts the two levels of the "then by"
// column back to back at each "group by" position (the densities come from
// `/api/statplots/ridgeline`, the violin's KDE). PAIRED: Y is the "before"
// column, the first "extra column" the "after"; each row is one subject.
// LOLLIPOP: one dot per group (its mean or median), no backend call.

import type { StatplotFigureSpec } from "../../lib/api/figures";
import { statsRidgeline } from "../../lib/api/statsDist2";
import type { LollipopSort, LollipopStat, Side, SideViolinStyle } from "../../lib/statDist3";
import { lollipopSeries, pairedSeries } from "../../lib/statDist3";
import { nestedTiers } from "../../lib/statMarks";
import type { GroupSpec } from "../../lib/statschooser";
import type { DataStruct } from "../../lib/types";
import { checkDensityGroups, columnOf, labelOf, ridgeBwOf, type MarginalPicks } from "./statDist2Draw";
import { lollipopYLabel, type LollipopDraw, type PairedDraw, type SideViolinDraw } from "./statRenderDist3";
import type { Dist2Picks } from "./useStatStagePicks";

type GroupedMode = "sideviolin" | "lollipop";

/** What the grouped draws read besides the groups. */
export interface GroupedOpts {
  side: SideViolinStyle;
  bw: Dist2Picks["ridgeBw"];
  stat: LollipopStat;
  sort: LollipopSort;
  valueLabel: string;
  /** The nest column's name when a "then by" column is active (else null). */
  nestLabel: string | null;
}

/** The positions and sides of a SPLIT violin from the nested group labels;
 *  throws unless the "then by" column has exactly two levels. */
export function splitLayout(
  labels: readonly string[],
  nestLabel: string | null,
): { positions: number[]; sides: Side[]; slotLabels: string[]; levels: string[] } {
  const tiers = nestedTiers(labels, nestLabel);
  if (!tiers) throw new Error('a split violin needs a "then by" column: pick one with two levels');
  const levels = [...new Set(tiers.inner)];
  if (levels.length !== 2) throw new Error(`a split violin needs exactly 2 "then by" levels, found ${levels.length}`);
  const slotLabels = tiers.runs.map((r) => r.label);
  const slots = tiers.pairs.map(([outer]) => slotLabels.indexOf(outer));
  return { positions: slots, sides: tiers.inner.map((l): Side => (l === levels[0] ? "left" : "right")), slotLabels, levels };
}

async function computeSideViolin(groups: readonly GroupSpec[], o: GroupedOpts): Promise<SideViolinDraw> {
  checkDensityGroups(groups);
  const style: SideViolinStyle = o.side;
  const layout =
    style === "split"
      ? splitLayout(groups.map((g) => g.label), o.nestLabel)
      : { positions: groups.map((_, i) => i), sides: groups.map((): Side => "right"), slotLabels: groups.map((g) => g.label), levels: [] };
  const bw = ridgeBwOf(o.bw);
  const values = groups.map((g) => g.values);
  const wire = await statsRidgeline(values, bw);
  return { mode: "sideviolin", wire, style, ...layout, groups: values, labels: groups.map((g) => g.label), bw, valueLabel: o.valueLabel };
}

/** The draw of a grouped Item 20 mode (not the ridgeline); rejects with the reason it cannot draw. */
export async function computeGroupedDraw(
  mode: GroupedMode,
  groups: readonly GroupSpec[],
  o: GroupedOpts,
): Promise<SideViolinDraw | LollipopDraw> {
  if (mode === "sideviolin") return computeSideViolin(groups, o);
  const values = groups.map((g) => g.values);
  const series = lollipopSeries(values, o.stat, o.sort);
  return { mode: "lollipop", series, groups: values, labels: groups.map((g) => g.label), valueLabel: o.valueLabel };
}

/** The "after" column of a paired plot: the first extra column that still exists
 *  and is not the "before", else the first other column; -2 when there is none. */
export function pairedAfterCol(histCols: readonly number[], before: number, width: number): number {
  const picked = histCols.find((c) => c >= 0 && c < width && c !== before);
  if (picked != null) return picked;
  for (let c = 0; c < width; c++) if (c !== before) return c;
  return -2;
}

/** The paired draw; rejects with the reason it cannot draw. */
export function computePairedDraw(data: DataStruct, o: Pick<MarginalPicks, "yCol" | "histCols"> & { ci: boolean }): PairedDraw {
  const after = pairedAfterCol(o.histCols, o.yCol, data.labels.length);
  if (after === -2) throw new Error('a paired plot needs a second column: pick the "after" column');
  const series = pairedSeries(columnOf(data, o.yCol), columnOf(data, after));
  return {
    mode: "paired", series, ci: o.ci, labels: [labelOf(data, o.yCol), labelOf(data, after)],
    valueLabel: "value",
  };
}

/** The export request for a settled side-violin / paired / lollipop draw, else null. */
export function dist3ExportSpec(draw: { mode: string } | null, fmt: string): StatplotFigureSpec | null {
  if (draw?.mode === "sideviolin") {
    const d = draw as SideViolinDraw;
    return {
      kind: "sideviolin", data: d.groups, labels: d.labels, fmt, y_label: d.valueLabel,
      dist3: { type: "sideviolin", style: d.style, slots: d.positions, sides: d.sides, slot_labels: d.slotLabels, levels: d.levels, bw: d.bw },
      filename: `${d.style}_violin_${d.valueLabel}`,
    };
  }
  if (draw?.mode === "paired") {
    const d = draw as PairedDraw;
    return {
      kind: "paired", data: [d.series.before, d.series.after], labels: [...d.labels], fmt, y_label: d.valueLabel,
      dist3: { type: "paired", ci: d.ci }, filename: `paired_${d.labels[0]}_${d.labels[1]}`,
    };
  }
  if (draw?.mode === "lollipop") {
    const d = draw as LollipopDraw;
    const { stat, sort } = d.series;
    return {
      kind: "lollipop", data: d.groups, labels: d.labels, fmt, y_label: lollipopYLabel(d),
      dist3: { type: "lollipop", stat: stat as LollipopStat, sort: sort as LollipopSort }, filename: `lollipop_${d.valueLabel}`,
    };
  }
  return null;
}
