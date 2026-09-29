// Pure per-slice compute helpers for the statistics stage (module-level: no
// React/store, so each is independently testable and reusable across the
// flat and faceted paths). Split out of useStatStage.ts to keep that hook
// from re-growing past its line-count ceiling (this file's contents used to
// live there — see git history — moved out wholesale, no behavior change).
//
// Faceted export (GUI_INTERACTION #12 slice 4b): `FacetDraw.rawGroups`
// (box/violin facets only) carries each panel's raw finite-value groups —
// export needs these (matplotlib's own boxplot/violinplot recompute their
// stats from raw values; they never reuse the interactive stage's
// precomputed boxes/violins), while bar facets don't need it (`draw.data`
// already has everything exportFigure needs, mean/SEM per category/series).
//
// Faceted points (JMP_GAP J5 residual, closed 2026-09-29): a panel's raw
// points (box / violin / strip `points`, a grouped bar cell's `raw`) carry
// ORIGINAL dataset rows — each slice's kept rows (`FacetSlice.rows`) composed
// with the analysis view's `rowIds` by `lib/facet.facetSliceRowIds`, the one
// recipe — so a panel's jitter is the flat plot's, on screen and in export.

import { statsBox, statsHistogram, statsQQ, statsViolin } from "../../lib/api";
import type { BoxStatWire } from "../../lib/api/stats";
import { buildBarMatrix, seriesStat, type BarChartData } from "../../lib/barlayout";
import { facetSliceRowIds, type FacetSlice } from "../../lib/facet";
import type { GroupSpec } from "../../lib/statschooser";
import {
  groupBoxStatsClient,
  resolveGroups,
  resolveGroupsIndexed,
  type BoxStat,
  type IndexedGroupSpec,
} from "../../lib/statstage";
import type { DataStruct } from "../../lib/types";
import { barCellPoints, withBarRaw } from "./statBarMarks";
import type { StatDrawData } from "./statRender";
import { withNestLabel } from "./statStageMarks";

/** One faceted small-multiple: a facet-column level's label + its own
 *  already-computed draw (GUI_INTERACTION #11). See this module's doc for
 *  `rawGroups`. */
export interface FacetDraw {
  label: string;
  draw: StatDrawData;
  rawGroups?: { label: string; values: number[] }[];
}

/** Q-Q mode's draw from a `/api/stats/qq` response. Moved here with
 *  `histogramDraw` (P2.6 box 2) from the hook's effect, which sits on a line
 *  pin: pure response -> draw mapping, no React. */
export function qqDraw(r: Awaited<ReturnType<typeof statsQQ>>, valueLabel: string): StatDrawData {
  return {
    mode: "qq",
    theo: r.theoretical_quantiles,
    obs: r.sample_quantiles,
    slope: r.slope,
    intercept: r.intercept,
    dist: r.dist,
    valueLabel,
  };
}

function numArr(v: unknown): number[] {
  return Array.isArray(v) ? v.map((x) => Number(x)) : [];
}

/** Histogram mode's draw from a `/api/stats/histogram` response. */
export function histogramDraw(
  r: Awaited<ReturnType<typeof statsHistogram>>,
  fit: string | null,
  valueLabel: string,
): StatDrawData {
  const fitBlock = r.fit as Record<string, unknown> | undefined;
  return {
    mode: "histogram",
    edges: numArr(r.edges),
    counts: numArr(r.counts),
    density: Boolean(r.density),
    fit: fitBlock ? { dist: String(fitBlock.dist ?? fit), x: numArr(fitBlock.x), pdf: numArr(fitBlock.pdf) } : undefined,
    valueLabel,
  };
}

/** Bar mode's category x series matrix for one dataset (flat OR one facet
 *  slice): a picked categorical column groups every plotted channel into its
 *  own clustered/stacked series; with no categorical column, fall back to one
 *  category per plotted channel (mirrors box/violin's own fallback).
 *  `raw` (P2.6 box 1, the flat plot only): attach each cell's raw points
 *  (`statBarMarks.withBarRaw`) — `rowIds` maps the analysis view's rows back
 *  to the dataset's, as the box family's points do. */
export function computeBarData(
  data: DataStruct,
  groupCol: number | null,
  valueChannels: readonly number[],
  valueLabels: readonly string[],
  valueCol: number,
  plotted: readonly number[],
  fallbackLabel: string,
  raw: { rowIds: readonly number[] | null } | null = null,
): BarChartData {
  const bd: BarChartData =
    groupCol != null
      ? buildBarMatrix(data, groupCol, valueChannels, valueLabels)
      : {
          groups: resolveGroups(data, null, valueCol, plotted).map((g) => ({ label: g.label, series: [seriesStat(g.values)] })),
          seriesLabels: [fallbackLabel],
        };
  return raw ? withBarRaw(bd, barCellPoints(data, groupCol, valueChannels, valueCol, plotted, raw.rowIds)) : bd;
}

/** The backend's box stats as the renderer reads them (P2.6 box 1). The wire
 *  is snake_case (`ci_lo` / `ci_hi`) and JSON has no NaN (an n<2 group's
 *  `sem` / `sd` arrive as null); passing the wire object straight through
 *  left `ciLo` / `ciHi` undefined, so with the backend up the screen's mean
 *  marker had NO CI whisker while the export (which recomputes) drew one. */
export function boxesFromWire(boxes: readonly BoxStatWire[]): BoxStat[] {
  const num = (v: number | null | undefined) => (typeof v === "number" ? v : NaN);
  return boxes.map((b) => ({
    label: b.label, q1: b.q1, median: b.median, q3: b.q3, iqr: b.iqr, whislo: b.whislo, whishi: b.whishi,
    mean: b.mean, n: b.n, fliers: b.fliers, sem: num(b.sem), sd: num(b.sd),
    ciLo: b.ci_lo === undefined ? undefined : num(b.ci_lo), ciHi: b.ci_hi === undefined ? undefined : num(b.ci_hi),
  }));
}

/** Box mode's draw for an already-resolved finite-groups list (flat OR one
 *  facet slice): the backend's exact box stats, degrading to the
 *  client-side fallback on failure. Takes `finiteGroups` directly (rather
 *  than re-resolving them) so the caller can share ONE `resolveGroups` call
 *  with whatever else needs the raw values (GUI_INTERACTION #12 slice 4b's
 *  faceted export, which needs the SAME raw groups this draw was computed
 *  from — matplotlib recomputes its own stats, never reusing these numbers).
 *  `points` (JMP_GAP J5 #1) rides through to BOTH the success and the
 *  client-fallback branch identically — it is a screen-only overlay,
 *  independent of whether the box stats themselves came from the backend or
 *  the offline fallback (the mean-CI marker / connect-means line — JMP_GAP
 *  J5 #2 / residual — are P2.6 box 1 marks, stamped on afterward by
 *  `statStageMarks.withMarks`, review finding 9: this function no longer
 *  takes or sets them at all). `degraded` in the return lets the caller
 *  decide whether to surface a "computed locally" note (the flat path
 *  does; the faceted path doesn't have a per-slice note affordance). */
export async function computeBoxDraw(
  finiteGroups: GroupSpec[],
  valueLabel: string,
  groupLabel: string,
  points: IndexedGroupSpec[] | null = null,
): Promise<{ draw: StatDrawData; degraded: boolean }> {
  try {
    const r = await statsBox(
      finiteGroups.map((g) => g.values),
      finiteGroups.map((g) => g.label),
    );
    return {
      draw: { mode: "box", boxes: boxesFromWire(r.boxes), valueLabel, groupLabel, points },
      degraded: false,
    };
  } catch {
    return {
      draw: { mode: "box", boxes: groupBoxStatsClient(finiteGroups), valueLabel, groupLabel, points },
      degraded: true,
    };
  }
}

/** Strip mode's draw (JMP_GAP J5 #3): reuses the SAME box-stats call as
 *  `computeBoxDraw` (mean/sem/ci95 for the optional mean+-CI marker) — it
 *  just never draws the quartile/whisker glyph on screen, and (unlike Box)
 *  its points overlay is always on, not toggle-gated. */
export async function computeStripDraw(
  finiteGroups: GroupSpec[],
  points: IndexedGroupSpec[],
  valueLabel: string,
  groupLabel: string,
): Promise<{ draw: StatDrawData; degraded: boolean }> {
  try {
    const r = await statsBox(
      finiteGroups.map((g) => g.values),
      finiteGroups.map((g) => g.label),
    );
    return {
      draw: { mode: "strip", boxes: boxesFromWire(r.boxes), points, valueLabel, groupLabel },
      degraded: false,
    };
  } catch {
    return {
      draw: { mode: "strip", boxes: groupBoxStatsClient(finiteGroups), points, valueLabel, groupLabel },
      degraded: true,
    };
  }
}

/** Violin mode's draw for an already-resolved finite-groups list (flat OR
 *  one facet slice): a real KDE per group, degrading to the SAME box stats
 *  `computeBoxDraw` would show for these groups on failure — the "never
 *  fabricate a KDE offline" rule. See `computeBoxDraw`'s doc for why this
 *  takes `finiteGroups` directly. P2.6 box 1: the draw also carries each
 *  group's box stats (the client's, the backend's own algorithm) for its
 *  summary marker and error bar — the export reads `calc.statplots.
 *  box_stats` over the same values. */
export async function computeViolinDraw(
  finiteGroups: GroupSpec[],
  valueLabel: string,
  groupLabel: string,
): Promise<StatDrawData> {
  try {
    const rs = await Promise.all(finiteGroups.map((g) => statsViolin(g.values)));
    return {
      mode: "violin",
      violins: rs.map((r, i) => ({
        label: finiteGroups[i].label,
        x: r.x,
        density: r.density,
        quartiles: r.quartiles,
        n: r.n,
      })),
      boxes: groupBoxStatsClient(finiteGroups),
      valueLabel,
      groupLabel,
    };
  } catch {
    return { mode: "box", boxes: groupBoxStatsClient(finiteGroups), valueLabel, groupLabel };
  }
}

/** The analysis view's `rowIds` (null: nothing dropped), when a faceted
 *  compute must resolve raw points; null when no mark needs them. */
export type FacetRaw = { rowIds: readonly number[] | null } | null;

/** Bar facet path is synchronous (no backend round-trip) — one matrix per
 *  slice via `computeBarData`, dropping any slice that groups to nothing.
 *  `raw`: attach each cell's raw points, rows mapped per slice. */
export function computeFacetBarDraws(
  slices: readonly FacetSlice[],
  groupCol: number | null,
  barValueChannels: readonly number[],
  barLabels: readonly string[],
  valueCol: number,
  plotted: readonly number[],
  barValueLabel: string,
  barStack: boolean,
  groupLabel: string,
  raw: FacetRaw = null,
): FacetDraw[] {
  const out: FacetDraw[] = [];
  for (const s of slices) {
    const sliceRaw = raw ? { rowIds: facetSliceRowIds(s, raw.rowIds) } : null;
    const bd = computeBarData(s.data, groupCol, barValueChannels, barLabels, valueCol, plotted, barValueLabel, sliceRaw);
    if (bd.groups.length > 0) {
      out.push({
        label: s.label,
        draw: { mode: "bar", data: bd, valueLabel: barValueLabel, groupLabel, stacked: barStack },
      });
    }
  }
  return out;
}

/** Box/Violin/Strip facet path: one async compute per slice (in parallel),
 *  each independently degrading on failure (a backend hiccup on one slice
 *  never takes down the others); slices with no finite groups drop. `raw`
 *  (the flat path's `needsPoints`; strip always) resolves each panel's
 *  indexed points, ORIGINAL rows via `facetSliceRowIds`; the marks
 *  (`statStageMarks.facetMarks`) are stamped on afterward. */
export async function computeFacetGroupDraws(
  slices: readonly FacetSlice[],
  mode: "box" | "violin" | "strip",
  groupCol: number | null,
  valueCol: number,
  plotted: readonly number[],
  valueLabel: string,
  groupLabel: string,
  /** The NESTED second factor (Group R), or null. Passed through so a facet
   *  panel shows the SAME boxes the flat panel would — a facet that silently
   *  collapsed the nesting would disagree with its own axis label, which names
   *  both factors. */
  group2Col: number | null = null,
  /** Review finding 4: the nest column's OWN display name (`useStatStage`'s
   *  `nestLabel`), stamped on each panel's draw so its two-tier axis is
   *  read the same structural way the flat plot's is — never sniffed off
   *  the panel's own composite label text. Null outside a nested plot. */
  nestLabel: string | null = null,
  raw: FacetRaw = null,
): Promise<FacetDraw[]> {
  const rs = await Promise.all(
    slices.map(async (s): Promise<FacetDraw | null> => {
      const finiteGroups = resolveGroups(s.data, groupCol, valueCol, plotted, group2Col).filter(
        (g) => g.values.length > 0,
      );
      if (!finiteGroups.length) return null;
      // Same partition as `finiteGroups` (index-aligned), rows mapped back.
      const pts = raw || mode === "strip"
        ? resolveGroupsIndexed(s.data, groupCol, valueCol, plotted, group2Col, facetSliceRowIds(s, raw?.rowIds ?? null))
          .filter((g) => g.points.length > 0)
        : null;
      let draw: StatDrawData;
      if (mode === "box") draw = (await computeBoxDraw(finiteGroups, valueLabel, groupLabel, pts)).draw;
      else if (mode === "strip") draw = (await computeStripDraw(finiteGroups, pts ?? [], valueLabel, groupLabel)).draw;
      else {
        draw = await computeViolinDraw(finiteGroups, valueLabel, groupLabel);
        if (pts && (draw.mode === "violin" || draw.mode === "box")) draw = { ...draw, points: pts };
      }
      // Export fidelity (GUI_INTERACTION #12 slice 4b): carry the raw groups
      // this draw was computed from so exportFigure can rebuild a faithful
      // per-facet request without a second resolveGroups pass.
      const rawGroups = finiteGroups.map((g) => ({ label: g.label, values: g.values }));
      return { label: s.label, draw: withNestLabel(draw, nestLabel), rawGroups };
    }),
  );
  return rs.filter((f): f is FacetDraw => f !== null);
}
