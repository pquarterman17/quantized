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
import type { AxisSlot } from "../../lib/groupAxis";
import type { GroupSpec } from "../../lib/statschooser";
import { finiteOf, type IndexedGroupSpec, type StatMode } from "../../lib/statstage";
import type { DataStruct } from "../../lib/types";
import type { StatDrawData } from "./statRender";
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
): StatplotFigureSpec | null {
  if (mode === "box" || mode === "violin" || mode === "strip") {
    const finiteGroups = groups.filter((g) => g.values.length > 0);
    if (!finiteGroups.length) return null;
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
      data: finiteGroups.map((g) => g.values),
      labels: finiteGroups.map((g) => g.label),
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
  /** P2.6 box 2: the per-group n annotation and the small-n / unbalanced
   *  caveat, exactly as the screen shows them. */
  showN?: boolean;
  caveat?: string | null;
}

/** Restate raw groups on the draw's axis (P2.6 box 2): one entry per AXIS
 *  slot, an empty slot as `[]` (the backend keeps its tick and marks it
 *  `n=0`). Returns null — keep the groups as they are — when there is no axis
 *  or it does not place exactly these groups (a stale draw mid-recompute). */
export function onAxis<T>(
  slots: readonly AxisSlot[] | null | undefined,
  perGroup: readonly T[],
  empty: T,
): { labels: string[]; values: T[] } | null {
  if (!slots) return null;
  if (slots.filter((s) => s.group !== null).length !== perGroup.length) return null;
  return {
    labels: slots.map((s) => s.label),
    values: slots.map((s) => (s.group === null ? empty : perGroup[s.group])),
  };
}

/** A bar matrix on the wire: NaN means become null (JSON has no NaN; the
 *  route draws no bar for them), and `counts` rides only when n is shown. */
function barWire(d: BarChartData, showN: boolean) {
  return {
    groups: d.groups.map((g) => g.label),
    series: d.seriesLabels,
    values: d.groups.map((g) => g.series.map((s) => (Number.isFinite(s.mean) ? s.mean : null))),
    errors: d.groups.map((g) => g.series.map((s) => (Number.isFinite(s.sem) ? s.sem : null))),
    counts: showN ? d.groups.map((g) => g.series.map((s) => s.n)) : null,
  };
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
  const showN = o.showN ?? false;
  const caveat = o.caveat ?? null;
  if (!drawFacets || drawFacets.length === 0) return;
  if (mode === "bar") {
    const facets: CategoricalFacetSpec[] = [];
    for (const f of drawFacets) {
      const draw = f.draw;
      if (draw.mode !== "bar") continue;
      facets.push({ label: f.label, ...barWire(draw.data, showN) });
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
      caveat,
    };
    await exportCategoricalFigure(spec);
    return;
  }
  if (mode !== "box" && mode !== "violin") return;
  const facets: StatplotFacetSpec[] = [];
  for (const f of drawFacets) {
    if (!f.rawGroups || f.rawGroups.length === 0) continue;
    const slots = f.draw.mode === "box" || f.draw.mode === "violin" ? f.draw.slots : null;
    const axis = onAxis(slots, f.rawGroups.map((g) => g.values), []);
    facets.push({
      label: f.label,
      kind: f.draw.mode === "violin" ? "violin" : "box",
      data: axis ? axis.values : f.rawGroups.map((g) => g.values),
      labels: axis ? axis.labels : f.rawGroups.map((g) => g.label),
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
    show_n: showN,
    caveat,
  };
  await exportStatplotFigure(spec);
}

/** Everything the stage's "Export" button needs — moved out of
 *  `useStatStage.exportFigure` (P2.6 box 2 funded its line pin with it). The
 *  draws are the DECORATED ones (`statStageLevels.applyLevels`), so the export
 *  reads the same axis, empty slots and caveat the screen shows. */
export interface StatStageExportInputs extends FacetedExportInputs {
  data: DataStruct;
  draw: StatDrawData | null;
  groups: GroupSpec[];
  indexedGroups: IndexedGroupSpec[];
  valueCol: number;
  dist: string;
  bins: string;
  fit: string | null;
  showPoints: boolean;
  showMeanCI: boolean;
  connectMeans: boolean;
}

export async function exportStatStage(fmt: string, o: StatStageExportInputs): Promise<void> {
  const { mode, draw } = o;
  const showN = o.showN ?? false;
  const caveat = o.caveat ?? null;
  // Faceted export (GUI_INTERACTION #12 slice 4b): drawFacets is set for
  // exactly the modes that facet (box/violin/bar). Checked first.
  if (o.drawFacets && o.drawFacets.length > 0) {
    await exportFacetedFigure(fmt, o);
    return;
  }
  if (mode === "bar") {
    if (!draw || draw.mode !== "bar" || draw.data.groups.length === 0) return;
    await exportCategoricalFigure({
      ...barWire(draw.data, showN && !o.barStack),
      stacked: o.barStack,
      caveat,
      fmt,
      title: `${o.barValueLabel} by ${o.groupLabel}`,
      x_label: o.groupLabel,
      y_label: o.barValueLabel,
      filename: `bar_${o.barValueLabel}`,
    });
    return;
  }
  // Box's points overlay (JMP_GAP J5 #1) and Strip mode (#3, which always
  // shows points) both need each group's ORIGINAL dataset row indices --
  // `point_row_indices` (parallel to the values `buildExportSpec` sends)
  // so the export scatters points in the SAME relative spot the screen
  // does (identical deterministic-jitter hash, both sides).
  let pointRowIndices: number[][] | null = null;
  if (mode === "strip" || (mode === "box" && o.showPoints)) {
    const finiteIndexed = o.indexedGroups.filter((g) => g.points.length > 0);
    pointRowIndices = finiteIndexed.map((g) => g.points.map((p) => p.rowIndex));
  }
  const spec = buildExportSpec(
    mode, o.data, o.groups, o.valueCol, o.valueLabel, o.groupLabel, o.dist, o.bins, o.fit, fmt,
    o.showPoints, pointRowIndices, o.showMeanCI, o.connectMeans,
  );
  if (!spec) return;
  if (mode === "box" || mode === "violin" || mode === "strip") {
    const slots = draw && (draw.mode === "box" || draw.mode === "violin" || draw.mode === "strip") ? draw.slots : null;
    const axis = onAxis(slots, spec.data as number[][], []);
    if (axis) {
      spec.data = axis.values;
      spec.labels = axis.labels;
      if (pointRowIndices) spec.point_row_indices = onAxis(slots, pointRowIndices, [])?.values ?? null;
    }
    spec.show_n = showN;
    spec.caveat = caveat;
  }
  await exportStatplotFigure(spec);
}
