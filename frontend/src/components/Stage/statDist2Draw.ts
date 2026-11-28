// The Stat Stage's marginal and ridgeline draws (plan item 20): which backend
// call each makes for the picked columns / groups, and the export request for
// the settled draw. Split out of `useStatStage.ts` (its 500-line ceiling).
//
// MARGINAL: Y is the value column; X is the first "extra column" (`histCols[0]`)
// or, with none, the dataset's own X column (index -1). A row needs both values
// finite, and the pairs the backend returns are the ones the screen draws and
// the export re-sends. RIDGELINE: one ridge per group the stage already resolved
// (the "group by" column, or one per plotted channel), drawn with the violin's KDE; opt-in
// `each` scales every ridge to its own peak, and the overlap / bandwidth are free numbers.
//
// MARGINAL ENCODINGS (opt-in): a group split (the stage's "group by" column), a colour column
// and a size column. A row needs every picked value finite; the pairs, ids and values the
// backend returns are what the screen draws and the export re-sends. Colour and a group split
// both colour the points, so asking for both is refused by name.

import type { StatplotFigureSpec } from "../../lib/api/figures";
import { statsMarginal, statsRidgeline } from "../../lib/api/statsDist2";
import { resolveCategoryLabels } from "../../lib/barlayout";
import { categoryLevels } from "../../lib/categorical";
import type { MarginalEncodings, MarginalKind } from "../../lib/statMarginal";
import type { RidgeBw } from "../../lib/statRidgeline";
import type { GroupSpec } from "../../lib/statschooser";
import type { DataStruct } from "../../lib/types";
import type { MarginalDraw } from "./statRenderMarginal";
import type { RidgelineDraw } from "./statRenderRidgeline";

export interface MarginalPicks {
  /** The Y column (the stage's value column). */
  yCol: number;
  /** The "extra columns" pick; its first entry is X. */
  histCols: readonly number[];
  kind: MarginalKind;
  bins: string;
  /** The opt-in encodings: the "group by" column when the strips split by group, the colour-by
   *  and size-by columns (null / absent: off). */
  groupCol?: number | null;
  colorCol?: number | null;
  sizeCol?: number | null;
}

/** The bandwidth pick: "scott", "silverman" or a positive factor as text. */
type BwPick = string;

/** The X column a marginal plot uses: the first extra column that still exists,
 *  else the dataset's X column (-1). */
export function marginalXCol(histCols: readonly number[], width: number): number {
  return histCols.find((c) => c >= 0 && c < width) ?? -1;
}

export const columnOf = (d: DataStruct, i: number): number[] => (i < 0 ? d.time : d.values.map((r) => r[i]));
export const labelOf = (d: DataStruct, i: number): string => (i < 0 ? "x" : (d.labels[i] ?? `column ${i}`));

/** The encodings' rows and wire arrays for the complete (x, y) pairs; throws the reason a
 *  contradictory or unusable pick cannot draw. */
function marginalEncodings(data: DataStruct, o: MarginalPicks, xs: number[], ys: number[]) {
  const width = data.labels.length;
  const col = (c: number | null | undefined) => (c != null && c >= -1 && c < width ? c : null);
  const g = col(o.groupCol);
  const c = col(o.colorCol);
  const s = col(o.sizeCol);
  if (g != null && c != null) throw new Error("a group split and a colour column both colour the points: pick one of them");
  const group = g != null ? columnOf(data, g) : null;
  const color = c != null ? columnOf(data, c) : null;
  const size = s != null ? columnOf(data, s) : null;
  const keep = xs.map(
    (x, i) =>
      Number.isFinite(x) && Number.isFinite(ys[i]) &&
      [group, color, size].every((v) => v == null || Number.isFinite(v[i])),
  );
  const pick = (v: number[] | null) => (v ? v.filter((_, i) => keep[i]) : null);
  const enc: MarginalEncodings = {};
  if (group && g != null) {
    const kept = pick(group)!;
    const present = new Set(kept);
    const levels = categoryLevels(data, g).filter((l) => present.has(l));
    enc.group = kept.map((v) => levels.indexOf(v));
    enc.group_labels = resolveCategoryLabels(data, g, levels);
  }
  if (color && c != null) Object.assign(enc, { color: pick(color), color_label: labelOf(data, c) });
  if (size && s != null) Object.assign(enc, { size: pick(size), size_label: labelOf(data, s) });
  return { keep, enc };
}

/** The marginal draw; rejects with the reason it cannot draw. */
export async function computeMarginalDraw(data: DataStruct, o: MarginalPicks): Promise<MarginalDraw> {
  const xCol = marginalXCol(o.histCols, data.labels.length);
  const xs = columnOf(data, xCol);
  const ys = columnOf(data, o.yCol);
  const { keep, enc } = marginalEncodings(data, o, xs, ys);
  const x = xs.filter((_, i) => keep[i]);
  const y = ys.filter((_, i) => keep[i]);
  if (x.length < 2) throw new Error("need ≥ 2 rows with both x and y finite");
  const wire = await statsMarginal(x, y, o.kind, o.bins, enc);
  return { mode: "marginal", wire, xLabel: labelOf(data, xCol), yLabel: labelOf(data, o.yCol), enc };
}

/** The bandwidth the wire takes: a rule, or the numeric factor a pick spells. */
export const ridgeBwOf = (pick: string): RidgeBw => (pick === "scott" || pick === "silverman" ? pick : Number(pick));

/** Throws naming the first group a KDE cannot be made of (it needs two distinct values). */
export function checkDensityGroups(groups: readonly GroupSpec[]): void {
  for (const g of groups) {
    if (g.values.length < 2 || Math.min(...g.values) === Math.max(...g.values)) {
      throw new Error(`"${g.label}" needs at least 2 distinct values for a density`);
    }
  }
}

/** The ridgeline draw for the resolved groups; rejects naming a group that has
 *  no density (a KDE needs two distinct values). */
export async function computeRidgelineDraw(
  groups: readonly GroupSpec[],
  valueLabel: string,
  overlap: number,
  bwPick: BwPick,
  each = false,
): Promise<RidgelineDraw> {
  checkDensityGroups(groups);
  const bw = ridgeBwOf(bwPick);
  const values = groups.map((g) => g.values);
  const wire = await statsRidgeline(values, bw);
  return { mode: "ridgeline", wire, labels: groups.map((g) => g.label), groups: values, overlap, bw, valueLabel, ...(each ? { each } : {}) };
}

/** The export request for a settled marginal / ridgeline draw, else null. */
export function dist2ExportSpec(
  draw: { mode: string } | null,
  bins: string,
  fmt: string,
): StatplotFigureSpec | null {
  if (draw?.mode === "marginal") {
    const d = draw as MarginalDraw;
    return {
      kind: "marginal", data: [d.wire.x, d.wire.y], labels: [d.xLabel, d.yLabel], bins, fmt,
      marginal: { kind: d.wire.kind, ...d.enc }, x_label: d.xLabel, y_label: d.yLabel,
      filename: `marginal_${d.yLabel}_vs_${d.xLabel}`,
    };
  }
  if (draw?.mode === "ridgeline") {
    const d = draw as RidgelineDraw;
    return {
      kind: "ridgeline", data: d.groups, labels: d.labels, fmt, ridgeline: { overlap: d.overlap, bw: d.bw, ...(d.each ? { each: true } : {}), ...(d.sharedMax != null && !d.each ? { d_max: d.sharedMax } : {}) },
      x_label: d.valueLabel, filename: `ridgeline_${d.valueLabel}`,
    };
  }
  return null;
}
