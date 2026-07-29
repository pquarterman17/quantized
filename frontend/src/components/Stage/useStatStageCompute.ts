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

import { statsBox, statsViolin } from "../../lib/api";
import { buildBarMatrix, seriesStat, type BarChartData } from "../../lib/barlayout";
import type { GroupSpec } from "../../lib/statschooser";
import { groupBoxStatsClient, resolveGroups, type IndexedGroupSpec } from "../../lib/statstage";
import type { DataStruct } from "../../lib/types";
import type { StatDrawData } from "./statRender";

/** One faceted small-multiple: a facet-column level's label + its own
 *  already-computed draw (GUI_INTERACTION #11). See this module's doc for
 *  `rawGroups`. */
export interface FacetDraw {
  label: string;
  draw: StatDrawData;
  rawGroups?: { label: string; values: number[] }[];
}

/** Bar mode's category x series matrix for one dataset (flat OR one facet
 *  slice): a picked categorical column groups every plotted channel into its
 *  own clustered/stacked series; with no categorical column, fall back to one
 *  category per plotted channel (mirrors box/violin's own fallback). */
export function computeBarData(
  data: DataStruct,
  groupCol: number | null,
  valueChannels: readonly number[],
  valueLabels: readonly string[],
  valueCol: number,
  plotted: readonly number[],
  fallbackLabel: string,
): BarChartData {
  if (groupCol != null) return buildBarMatrix(data, groupCol, valueChannels, valueLabels);
  const fallbackGroups = resolveGroups(data, null, valueCol, plotted);
  return {
    groups: fallbackGroups.map((g) => ({ label: g.label, series: [seriesStat(g.values)] })),
    seriesLabels: [fallbackLabel],
  };
}

/** Box mode's draw for an already-resolved finite-groups list (flat OR one
 *  facet slice): the backend's exact box stats, degrading to the
 *  client-side fallback on failure. Takes `finiteGroups` directly (rather
 *  than re-resolving them) so the caller can share ONE `resolveGroups` call
 *  with whatever else needs the raw values (GUI_INTERACTION #12 slice 4b's
 *  faceted export, which needs the SAME raw groups this draw was computed
 *  from — matplotlib recomputes its own stats, never reusing these numbers).
 *  `points`/`showMeanCI` (JMP_GAP J5 #1/#2) ride through to BOTH the
 *  success and the client-fallback branch identically — the marks are a
 *  screen-only overlay, independent of whether the box stats themselves
 *  came from the backend or the offline fallback. `degraded` in the return
 *  lets the caller decide whether to surface a "computed locally" note (the
 *  flat path does; the faceted path doesn't have a per-slice note affordance). */
export async function computeBoxDraw(
  finiteGroups: GroupSpec[],
  valueLabel: string,
  groupLabel: string,
  points: IndexedGroupSpec[] | null = null,
  showMeanCI = false,
): Promise<{ draw: StatDrawData; degraded: boolean }> {
  try {
    const r = await statsBox(
      finiteGroups.map((g) => g.values),
      finiteGroups.map((g) => g.label),
    );
    return { draw: { mode: "box", boxes: r.boxes, valueLabel, groupLabel, points, showMeanCI }, degraded: false };
  } catch {
    return {
      draw: { mode: "box", boxes: groupBoxStatsClient(finiteGroups), valueLabel, groupLabel, points, showMeanCI },
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
  showMeanCI: boolean,
): Promise<{ draw: StatDrawData; degraded: boolean }> {
  try {
    const r = await statsBox(
      finiteGroups.map((g) => g.values),
      finiteGroups.map((g) => g.label),
    );
    return { draw: { mode: "strip", boxes: r.boxes, points, valueLabel, groupLabel, showMeanCI }, degraded: false };
  } catch {
    return {
      draw: {
        mode: "strip", boxes: groupBoxStatsClient(finiteGroups), points, valueLabel, groupLabel, showMeanCI,
      },
      degraded: true,
    };
  }
}

/** Violin mode's draw for an already-resolved finite-groups list (flat OR
 *  one facet slice): a real KDE per group, degrading to the SAME box stats
 *  `computeBoxDraw` would show for these groups on failure — the "never
 *  fabricate a KDE offline" rule. See `computeBoxDraw`'s doc for why this
 *  takes `finiteGroups` directly. */
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
      valueLabel,
      groupLabel,
    };
  } catch {
    return { mode: "box", boxes: groupBoxStatsClient(finiteGroups), valueLabel, groupLabel };
  }
}

/** Bar facet path is synchronous (no backend round-trip) — one matrix per
 *  slice via `computeBarData`, dropping any slice that groups to nothing. */
export function computeFacetBarDraws(
  slices: readonly { label: string; data: DataStruct }[],
  groupCol: number | null,
  barValueChannels: readonly number[],
  barLabels: readonly string[],
  valueCol: number,
  plotted: readonly number[],
  barValueLabel: string,
  barStack: boolean,
  groupLabel: string,
): FacetDraw[] {
  const out: FacetDraw[] = [];
  for (const s of slices) {
    const bd = computeBarData(s.data, groupCol, barValueChannels, barLabels, valueCol, plotted, barValueLabel);
    if (bd.groups.length > 0) {
      out.push({
        label: s.label,
        draw: { mode: "bar", data: bd, valueLabel: barValueLabel, groupLabel, stacked: barStack },
      });
    }
  }
  return out;
}

/** Box/Violin facet path: one async compute per slice (in parallel), each
 *  independently degrading on failure (a backend hiccup on one slice never
 *  takes down the others); slices with no finite groups drop. Faceted box
 *  marks aren't wired yet (JMP_GAP J5 residual — points/mean-CI stay
 *  flat-panel only for now): the box branch's draw always carries
 *  `points: null, showMeanCI: false`. */
export async function computeFacetGroupDraws(
  slices: readonly { label: string; data: DataStruct }[],
  mode: "box" | "violin",
  groupCol: number | null,
  valueCol: number,
  plotted: readonly number[],
  valueLabel: string,
  groupLabel: string,
): Promise<FacetDraw[]> {
  const rs = await Promise.all(
    slices.map(async (s): Promise<FacetDraw | null> => {
      const finiteGroups = resolveGroups(s.data, groupCol, valueCol, plotted).filter(
        (g) => g.values.length > 0,
      );
      if (!finiteGroups.length) return null;
      const draw =
        mode === "box"
          ? (await computeBoxDraw(finiteGroups, valueLabel, groupLabel)).draw
          : await computeViolinDraw(finiteGroups, valueLabel, groupLabel);
      // Export fidelity (GUI_INTERACTION #12 slice 4b): carry the raw groups
      // this draw was computed from so exportFigure can rebuild a faithful
      // per-facet request without a second resolveGroups pass.
      const rawGroups = finiteGroups.map((g) => ({ label: g.label, values: g.values }));
      return { label: s.label, draw, rawGroups };
    }),
  );
  return rs.filter((f): f is FacetDraw => f !== null);
}
