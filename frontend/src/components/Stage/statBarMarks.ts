// Raw points and the summary marker on GROUPED bars (P2.6 box 1, second pass):
// which rows sit in each (category, series) cell, and which values a bar's
// marks put on the plot. Pure — the painter (`statRenderBar.drawBarCellMarks`),
// the value domain / hit-test (`statDrawMarks.barDomainCandidates`) and the
// export request (`statStageExport`'s `raw` / `raw_rows`) all read these.
//
// The rules, identical on both sides (`calc.figure_stat_marks.
// overlay_bar_marks` is the export twin):
//   * a cell's points are the finite values of that series' channel on the
//     category's rows, each with its ORIGINAL dataset row (`rowIds` maps the
//     filtered analysis view back — the box family's jitter identity, so
//     excluding one row never reshuffles another);
//   * the jitter is the box family's deterministic `(row, category)` hash,
//     scaled by the BAR's half-width;
//   * "outliers" = outside the cell's own Tukey whiskers; the summary marker
//     is a diamond at the bar's mean or a square at the cell's median;
//   * stacked bars draw none of it (a raw value has no place in a stack), and
//     a facet panel draws them over its own cells (rows per slice via
//     `lib/facet.facetSliceRowIds`, JMP_GAP J5 residual closed 2026-09-29).

import type { BarCellRaw, BarChartData, BarSeriesStat } from "../../lib/barlayout";
import { categoryLevels, columnOf } from "../../lib/categorical";
import { isOutlier, type ResolvedStatMarks } from "../../lib/statMarks";
import { groupsFromColumnsIndexed, type IndexedPoint } from "../../lib/statschooser";
import { boxStatsClient } from "../../lib/statstage";
import type { DataStruct } from "../../lib/types";

/** Whether bar marks need each cell's raw points (points or a median). */
export function needsBarRaw(m: ResolvedStatMarks): boolean {
  return m.points !== "none" || m.summary === "median";
}

/** Each cell's raw points, `[group][series]`, in `buildBarMatrix`'s own
 *  category order (every level of `groupCol`, ascending) — or, with no group
 *  column, one category per plotted channel (`computeBarData`'s fallback). */
export function barCellPoints(
  data: DataStruct,
  groupCol: number | null,
  valueChannels: readonly number[],
  valueCol: number,
  plotted: readonly number[],
  rowIds: readonly number[] | null,
): IndexedPoint[][][] {
  if (groupCol == null) {
    return groupsFromColumnsIndexed(data, plotted.length ? plotted : [valueCol], rowIds).map((g) => [g.points]);
  }
  const by = columnOf(data, groupCol);
  const cols = valueChannels.map((c) => columnOf(data, c));
  return categoryLevels(data, groupCol).map((lvl) =>
    cols.map((col) => {
      const pts: IndexedPoint[] = [];
      for (let r = 0; r < by.length; r++) {
        if (by[r] === lvl && Number.isFinite(col[r])) pts.push({ value: col[r], rowIndex: rowIds?.[r] ?? r });
      }
      return pts;
    }),
  );
}

function cellRaw(points: IndexedPoint[] | undefined): BarCellRaw | null {
  if (!points?.length) return null;
  const b = boxStatsClient(points.map((p) => p.value));
  return { points, median: b.median, whislo: b.whislo, whishi: b.whishi };
}

/** `bd` with each series' `raw` attached from `cells` (index-aligned). */
export function withBarRaw(bd: BarChartData, cells: IndexedPoint[][][]): BarChartData {
  return {
    ...bd,
    groups: bd.groups.map((g, gi) => ({
      ...g,
      series: g.series.map((s, si) => ({ ...s, raw: cellRaw(cells[gi]?.[si]) })),
    })),
  };
}

/** The raw points a bar cell DRAWS under `m` ("all", or its outliers). */
export function shownBarPoints(s: BarSeriesStat, m: ResolvedStatMarks): IndexedPoint[] {
  const raw = s.raw;
  if (!raw || m.points === "none") return [];
  return m.points === "all" ? raw.points : raw.points.filter((p) => isOutlier(p.value, raw));
}

/** Every value a grouped bar's marks put on the plot (its shown points and
 *  its median square; the mean diamond sits on the bar top, already in the
 *  domain) — folded into the value domain so nothing is drawn off-canvas,
 *  as matplotlib's autoscale folds in the same artists on export. */
export function barMarkExtents(s: BarSeriesStat, m: ResolvedStatMarks): number[] {
  const out = shownBarPoints(s, m).map((p) => p.value);
  if (m.summary === "median" && s.raw) out.push(s.raw.median);
  return out;
}

/** The export's bar-marks fields (`routes/export_statplots.
 *  CategoricalFigureRequest`), or nothing when no mark is on — so a plot
 *  without them posts the request it always did. `raw` / `raw_rows` ride
 *  only when a point or a median needs them. */
export function barMarksWire(d: BarChartData, m: ResolvedStatMarks | null, on: boolean) {
  if (!m || !on || (m.points === "none" && m.summary === "none")) return {};
  const cells = (f: (p: IndexedPoint) => number) => d.groups.map((g) => g.series.map((s) => s.raw?.points.map(f) ?? []));
  return {
    points: m.points,
    jitter_width: m.jitterWidth,
    summary: m.summary,
    ...(needsBarRaw(m) ? { raw: cells((p) => p.value), raw_rows: cells((p) => p.rowIndex) } : {}),
  };
}
