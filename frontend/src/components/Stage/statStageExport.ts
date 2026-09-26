// The server-side figure SPEC the Stat Stage exports — the same groups the
// screen drew, restated as a `routes/export_statplots` request.
//
// Extracted from `useStatStage.ts` (Group R) as the second half of funding the
// nested second factor: that hook sits on a hard line pin and this is its
// largest piece that touches no React at all. Pure in / pure out, so every
// branch unit-tests standalone.
//
// IMPORTED EAGERLY, and the dynamic `import()` that was here is gone — it was
// built, measured, and reverted, which is the second time this repo has had to
// learn that (see check-bundle-size.mjs's BUG-009 block).
//
// The bundle gate refused this PR over budget, and its guidance names exactly
// this shape: "anything only needed after a user action can be a dynamic
// import()". Export IS only needed after a click, and the split is safe here in
// a way the BUG-009 one was not — nothing below reads live state, every input
// arrives as an argument, so WHEN it loads cannot change WHAT it returns. It
// still lost: splitting it made the EAGER total WORSE, 895.2 kB -> 895.6 kB.
// Rollup pulled 1.93 kB into a `statStageExport` chunk and the plumbing plus
// the shared modules it could no longer fold in cost more than that back. The
// lesson is the measurement, not the reasoning: try it, read the number.
//
// `finiteOf` and `colValues` still went to `lib/statstage.ts` rather than
// living here — the Q-Q and histogram branches call them synchronously during
// render, so they were never export-only to begin with.
//
// It needs no nesting parameter of its own, and that is the point: box/violin/
// strip export is PRE-AGGREGATED (`data: number[][]` + `labels: string[]`), so
// a nested plot exports by handing over the nested groups and their composite
// `lot = 1 / wafer = 3` labels. The number of boxes and what each one is called
// are the only things the backend needs to know.

import {
  exportCategoricalFigure,
  exportStatplotFigure,
  type CategoricalFacetSpec,
  type CategoricalFigureSpec,
  type StatplotFacetSpec,
  type StatplotFigureSpec,
} from "../../lib/api/figures";
import type { BarChartData } from "../../lib/barlayout";
import type { GroupSpec } from "../../lib/statschooser";
import { finiteOf, type IndexedGroupSpec, type StatMode } from "../../lib/statstage";
import type { DataStruct } from "../../lib/types";
import type { FacetDraw } from "./useStatStageCompute";

export function buildExportSpec(
  mode: StatMode,
  data: DataStruct,
  groups: GroupSpec[],
  valueCol: number,
  valueLabel: string,
  groupLabel: string,
  dist: string,
  bins: string,
  fit: string | null,
  fmt: string,
  showPoints = false,
  pointRowIndices: number[][] | null = null,
  showMeanCI = false,
  showConnectMeans = false,
  countLabels: (string | null)[] | null = null,
  footnote: string | null = null,
): StatplotFigureSpec | null {
  if (mode === "box" || mode === "violin" || mode === "strip") {
    // P2.6: EVERY slot is sent, empty ones included (`data: []`) — the backend
    // draws them as labelled `n=0` slots at the same axis positions the canvas
    // uses. Only an all-empty plot has nothing to export.
    if (!groups.some((g) => g.values.length > 0)) return null;
    // Violin has neither mark (JMP_GAP J5 is a box/strip feature) — omit
    // rather than send `false`/`null` no-ops on every violin export. Strip's
    // points overlay is always on (no toggle for it -- it's the whole plot),
    // so `show_points` is forced true there regardless of the (box-only)
    // `showPoints` toggle state.
    const marks =
      mode === "violin"
        ? {}
        : {
            show_points: mode === "strip" ? true : showPoints,
            point_row_indices: pointRowIndices,
            show_mean_ci: showMeanCI,
            show_connect_means: showConnectMeans,
          };
    return {
      kind: mode,
      data: groups.map((g) => g.values),
      labels: groups.map((g) => g.label),
      ...(countLabels ? { count_labels: countLabels } : {}),
      ...(footnote ? { footnote } : {}),
      fmt,
      title: `${valueLabel} by ${groupLabel}`,
      x_label: groupLabel,
      y_label: valueLabel,
      filename: `${mode}_${valueLabel}`,
      ...marks,
    };
  }
  const values = finiteOf(data, valueCol);
  if (mode === "qq") {
    if (values.length < 3) return null;
    return {
      kind: "qq",
      data: values,
      dist,
      fmt,
      title: `Q-Q — ${valueLabel}`,
      x_label: `Theoretical quantiles (${dist})`,
      y_label: `Sample quantiles (${valueLabel})`,
      filename: `qq_${valueLabel}`,
    };
  }
  if (values.length < 2) return null;
  return {
    kind: "histogram",
    data: values,
    bins,
    fit,
    fmt,
    title: `Histogram — ${valueLabel}`,
    x_label: valueLabel,
    y_label: fit ? "density" : "count",
    filename: `histogram_${valueLabel}`,
  };
}

/** Everything the Stat Stage's "Export figure" needs — the hook's render
 *  inputs, passed explicitly (moved out of `useStatStage.ts` for P2.6, which
 *  sits on a line pin). */
export interface StatStageExportInputs extends FacetedExportInputs {
  data: DataStruct | null;
  barData: BarChartData | null;
  /** The drawn SLOTS, empty ones included (P2.6). */
  groups: GroupSpec[];
  /** Slot-aligned points with their analysis-view row indices. */
  indexedGroups: IndexedGroupSpec[];
  valueCol: number;
  dist: string;
  bins: string;
  fit: string | null;
  showPoints: boolean;
  showMeanCI: boolean;
  showConnectMeans: boolean;
  countLabels: (string | null)[];
  footnote: string | null;
}

/** Render the Stat Stage's current plot server-side: the faceted grid when
 *  one is drawn, else the flat bar / statplot figure. */
export async function exportStatStageFigure(fmt: string, o: StatStageExportInputs): Promise<void> {
  const { data, drawFacets, mode, barStack, groupLabel, barValueLabel, valueLabel, barData } = o;
  if (!data) return;
  // Faceted export (GUI_INTERACTION #12 slice 4b): drawFacets is set for
  // exactly the modes that facet (box/violin/bar). Checked before the flat
  // branches below.
  if (drawFacets && drawFacets.length > 0) {
    await exportFacetedFigure(fmt, o);
    return;
  }
  if (mode === "bar") {
    if (!barData || barData.groups.length === 0) return;
    const spec: CategoricalFigureSpec = {
      groups: barData.groups.map((g) => g.label),
      series: barData.seriesLabels,
      values: barData.groups.map((g) => g.series.map((s) => s.mean)),
      errors: barData.groups.map((g) => g.series.map((s) => (Number.isFinite(s.sem) ? s.sem : null))),
      stacked: barStack,
      // P2.6: the canvas's per-bar (per-category when stacked) count labels.
      count_labels: o.countLabels,
      ...(o.footnote ? { footnote: o.footnote } : {}),
      fmt,
      title: `${barValueLabel} by ${groupLabel}`,
      x_label: groupLabel,
      y_label: barValueLabel,
      filename: `bar_${barValueLabel}`,
    };
    await exportCategoricalFigure(spec);
    return;
  }
  // Box's points overlay (JMP_GAP J5 #1) and Strip mode (#3, which always
  // shows points) both need each group's ORIGINAL row indices --
  // `point_row_indices` (parallel to the slots `buildExportSpec` sends, `[]`
  // for an empty one) so the export scatters points in the SAME relative spot
  // the screen does (identical deterministic-jitter hash, both sides).
  const pointRowIndices =
    mode === "strip" || (mode === "box" && o.showPoints)
      ? o.indexedGroups.map((g) => g.points.map((p) => p.rowIndex))
      : null;
  const spec = buildExportSpec(
    mode, data, o.groups, o.valueCol, valueLabel, groupLabel, o.dist, o.bins, o.fit, fmt,
    o.showPoints, pointRowIndices, o.showMeanCI, o.showConnectMeans, o.countLabels, o.footnote,
  );
  if (spec) await exportStatplotFigure(spec);
}

/** Everything `exportFacetedFigure` used to close over as a method on the
 *  hook. Passed explicitly so the whole export path can live out here.
 *  (Review finding 4: this said "and be loaded on demand", which the same
 *  commit had already falsified — the dynamic import was reverted, see the
 *  module header.) */
export interface FacetedExportInputs {
  drawFacets: FacetDraw[] | null;
  mode: StatMode;
  barStack: boolean;
  groupLabel: string;
  barValueLabel: string;
  valueLabel: string;
}

/** Rebuilds a `facets[]` wire payload from `drawFacets` and renders one
 *  faceted figure — the SAME ceil(sqrt(n)) grid the screen shows (gap
 *  #21's shared `calc.figure_facets` layout). Bar facets reuse
 *  `draw.data` directly (already the full category x series matrix,
 *  computed synchronously with no possible per-slice degrade); box/violin
 *  facets reuse the raw `rawGroups` values `computeFacetGroupDraws`
 *  attached, paired with each facet's OWN resolved `draw.mode` for
 *  per-slice degrade fidelity — a violin facet that fell back to box on
 *  screen (its own /api/statplots/violin call failed) exports as box, not
 *  a fresh (and maybe now-successful) violin recompute. */
export async function exportFacetedFigure(
  fmt: string,
  o: FacetedExportInputs,
): Promise<void> {
  const { drawFacets, mode, barStack, groupLabel, barValueLabel, valueLabel } = o;
  if (!drawFacets || drawFacets.length === 0) return;
  if (mode === "bar") {
    const facets: CategoricalFacetSpec[] = [];
    for (const f of drawFacets) {
      const draw = f.draw;
      if (draw.mode !== "bar") continue;
      facets.push({
        label: f.label,
        groups: draw.data.groups.map((g) => g.label),
        series: draw.data.seriesLabels,
        values: draw.data.groups.map((g) => g.series.map((s) => s.mean)),
        errors: draw.data.groups.map((g) => g.series.map((s) => (Number.isFinite(s.sem) ? s.sem : null))),
      });
    }
    if (!facets.length) return;
    const spec: CategoricalFigureSpec = {
      groups: facets[0].groups,
      series: facets[0].series,
      values: facets[0].values,
      errors: facets[0].errors,
      stacked: barStack,
      fmt,
      title: `${barValueLabel} by ${groupLabel}, faceted`,
      x_label: groupLabel,
      y_label: barValueLabel,
      filename: `bar_${barValueLabel}_faceted`,
      facets,
    };
    await exportCategoricalFigure(spec);
    return;
  }
  if (mode !== "box" && mode !== "violin") return;
  const facets: StatplotFacetSpec[] = [];
  for (const f of drawFacets) {
    if (!f.rawGroups || f.rawGroups.length === 0) continue;
    facets.push({
      label: f.label,
      kind: f.draw.mode === "violin" ? "violin" : "box",
      data: f.rawGroups.map((g) => g.values),
      labels: f.rawGroups.map((g) => g.label),
    });
  }
  if (!facets.length) return;
  const spec: StatplotFigureSpec = {
    kind: mode,
    data: facets[0].data,
    labels: facets[0].labels,
    fmt,
    title: `${valueLabel} by ${groupLabel}, faceted`,
    x_label: groupLabel,
    y_label: valueLabel,
    filename: `${mode}_${valueLabel}_faceted`,
    facets,
  };
  await exportStatplotFigure(spec);
}
