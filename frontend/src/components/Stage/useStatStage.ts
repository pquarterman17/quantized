// Statistics stage — state hook (the workshop pattern: hook + view, mirrors
// useMapCuts.ts alongside MapStage). Box/Violin group a value column by a
// categorical column (lib/modeling + lib/statschooser, like the Tabulate
// workshop) or fall back to one group per PLOTTED channel when the dataset
// carries no categorical column; Q-Q and Histogram work on one picked column.
// Reads the dataset's ANALYSIS view (lib/rowstate.analysisData, guard #11) so
// exclusion (#50) and the local filter (#53) both hold everywhere. Box has a
// client-side offline fallback (lib/statstage.boxStatsClient — the exact same
// algorithm as calc.statplots.box_stats); Violin/Q-Q/Histogram need the
// backend and surface an error otherwise — Violin specifically degrades to
// Box rather than ever fabricating a KDE offline.
//
// Parameterized over explicit params rather than store reads (MULTI_PLOT_PLAN
// item 15, the usePlotPayload precedent): the focused `StatStage` wrapper
// feeds it the live singleton fields (byte-identical behavior — the params
// are the exact store-selected references it used to read itself), while a
// background window feeds it the window's OWN `PlotView` snapshot
// (`windows/BackgroundAltModes.tsx`). ZERO store value imports (types only).
//
// Faceting (GUI_INTERACTION #11 residual): Box/Violin/Bar can facet by a
// second categorical column (`facetCol`, internal picker state — see its
// declaration below). When set, `drawFacets` holds one draw per facet-column
// level (`lib/facet.facetSlices` re-runs the SAME group/bar pipeline per
// slice) and the flat `draw` goes null; `drawFacets` is null the rest of the
// time. Background windows never facet (no Picker, no seed field reaches
// them) — see the param docs below.
//
// Faceted export (GUI_INTERACTION #12 slice 4b): `exportFigure` renders a
// small-multiples figure server-side (`calc.figure_facets`, the SAME
// ceil(sqrt(n)) grid drawFacets shows on screen) instead of the flat single
// panel. Box/Violin facets carry each panel's raw finite-value groups
// (`FacetDraw.rawGroups`, attached by `computeFacetGroupDraws`) AND that
// panel's own resolved mode (`FacetDraw.draw.mode`) — a violin facet that
// independently degraded to box on screen exports as box, per-slice mode
// fidelity, not a uniform re-request of the top-level picked mode.

import { useEffect, useMemo, useState } from "react";

import { buildBarMatrix, seriesStat, type BarChartData } from "../../lib/barlayout";
import {
  exportCategoricalFigure,
  exportStatplotFigure,
  statsBox,
  statsHistogram,
  statsQQ,
  statsViolin,
  type CategoricalFacetSpec,
  type CategoricalFigureSpec,
  type StatplotFacetSpec,
  type StatplotFigureSpec,
} from "../../lib/api";
import { facetSlices } from "../../lib/facet";
import { effectiveChannels } from "../../lib/plotdata";
import { analysisData } from "../../lib/rowstate";
import type { GroupSpec } from "../../lib/statschooser";
import {
  categoricalChannels,
  firstValueChannel,
  groupBoxStatsClient,
  resolveGroups,
  type StatMode,
} from "../../lib/statstage";
import type { DataStruct, Dataset } from "../../lib/types";
import type { StatStageSeed } from "../../store/useApp";
import type { StatDrawData } from "./statRender";

/** One faceted small-multiple: a facet-column level's label + its own
 *  already-computed draw (GUI_INTERACTION #11). `rawGroups` (box/violin
 *  facets only, GUI_INTERACTION #12 slice 4b) carries the raw finite-value
 *  groups `draw` was computed from — export needs these (matplotlib's own
 *  boxplot/violinplot recompute their stats from raw values; they never
 *  reuse the interactive stage's precomputed boxes/violins), while bar
 *  facets don't need it (`draw.data` already has everything exportFigure
 *  needs, mean/SEM per category/series). */
export interface FacetDraw {
  label: string;
  draw: StatDrawData;
  rawGroups?: { label: string; values: number[] }[];
}

export interface StatColumn {
  index: number;
  label: string;
}

export interface UseStatStageParams {
  /** The dataset under analysis (the focused wrapper passes the ACTIVE
   *  dataset; a background window passes its own bound dataset). */
  active: Dataset | null;
  yKeys: number[] | null;
  xKey: number | null;
  seriesOrder: number[] | null;
  /** Graph Builder "send to stage" cross-panel seed — a FOCUSED-stage
   *  concern: the wrapper passes the live `statStageSeed`; background
   *  windows pass null (seeding always targets the focused stage). */
  seed: StatStageSeed | null;
  /** Called once a non-null `seed` has been applied (the focused wrapper
   *  passes `clearStatStageSeed`; background windows pass a no-op). */
  onSeedConsumed: () => void;
}

export const DISTRIBUTIONS = ["norm", "logistic", "laplace", "uniform"] as const;
export const BIN_RULES = ["fd", "sturges", "scott", "rice", "sqrt", "auto"] as const;

export interface StatStageState {
  hasData: boolean;
  mode: StatMode;
  setMode: (m: StatMode) => void;
  /** All channels (0..) — the Q-Q/Histogram value picker. */
  columns: StatColumn[];
  /** Channels that read as categorical — the Box/Violin "group by" picker. */
  categoricalCols: StatColumn[];
  /** null = "(per plotted channel)" fallback (no categorical column picked). */
  groupCol: number | null;
  setGroupCol: (i: number | null) => void;
  valueCol: number;
  setValueCol: (i: number) => void;
  dist: string;
  setDist: (d: string) => void;
  bins: string;
  setBins: (b: string) => void;
  fit: string | null;
  setFit: (f: string | null) => void;
  /** Bar mode only (gap #20): grouped (false, clustered side-by-side) vs
   *  stacked (true, one bar per category). */
  barStack: boolean;
  setBarStack: (s: boolean) => void;
  /** Box/Violin/Bar "facet by" column (GUI_INTERACTION #11) — null = no
   *  facet (the ordinary single-panel draw). Internal picker state, not a
   *  hook param: background windows never seed or set one (see the module
   *  doc). */
  facetCol: number | null;
  setFacetCol: (i: number | null) => void;
  busy: boolean;
  error: string | null;
  /** Non-fatal note (e.g. an offline degrade) shown alongside the plot. */
  note: string | null;
  draw: StatDrawData | null;
  /** Small multiples for Box/Violin/Bar (#11) — one draw per facet-column
   *  level, non-null only when `facetCol` is set AND the mode is box/violin/
   *  bar. `draw` above is null while this is non-null (a facet grid has no
   *  single flat panel) — `exportFigure` below reads THIS instead when set
   *  (GUI_INTERACTION #12 slice 4b: faceted export renders a small-multiples
   *  figure matching this same grid, server-side via `calc.figure_facets`). */
  drawFacets: FacetDraw[] | null;
  /** Builds the same-shape request the interactive stage saw, for the
   *  "Export figure" button (a no-op when there's nothing to export yet).
   *  Renders a faceted small-multiples figure when `drawFacets` is set
   *  (GUI_INTERACTION #12 slice 4b), otherwise the flat single-panel figure
   *  from `draw`. */
  exportFigure: (fmt: string) => Promise<void>;
}

const colValues = (data: DataStruct, index: number): number[] =>
  index < 0 ? data.time : data.values.map((row) => row[index]);

const finiteOf = (data: DataStruct, index: number): number[] =>
  colValues(data, index).filter((v) => Number.isFinite(v));

function numArr(v: unknown): number[] {
  return Array.isArray(v) ? v.map((x) => Number(x)) : [];
}

// ── Pure per-slice compute helpers (module-level: no React/store, so each is
// independently testable and reusable across the flat and faceted paths) ──

/** Bar mode's category x series matrix for one dataset (flat OR one facet
 *  slice): a picked categorical column groups every plotted channel into its
 *  own clustered/stacked series; with no categorical column, fall back to one
 *  category per plotted channel (mirrors box/violin's own fallback). */
function computeBarData(
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
 *  from — matplotlib recomputes its own stats, never reusing these numbers). */
async function computeBoxDraw(
  finiteGroups: GroupSpec[],
  valueLabel: string,
  groupLabel: string,
): Promise<StatDrawData> {
  try {
    const r = await statsBox(
      finiteGroups.map((g) => g.values),
      finiteGroups.map((g) => g.label),
    );
    return { mode: "box", boxes: r.boxes, valueLabel, groupLabel };
  } catch {
    return { mode: "box", boxes: groupBoxStatsClient(finiteGroups), valueLabel, groupLabel };
  }
}

/** Violin mode's draw for an already-resolved finite-groups list (flat OR
 *  one facet slice): a real KDE per group, degrading to the SAME box stats
 *  `computeBoxDraw` would show for these groups on failure — the "never
 *  fabricate a KDE offline" rule. See `computeBoxDraw`'s doc for why this
 *  takes `finiteGroups` directly. */
async function computeViolinDraw(
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
function computeFacetBarDraws(
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
 *  takes down the others); slices with no finite groups drop. */
async function computeFacetGroupDraws(
  slices: readonly { label: string; data: DataStruct }[],
  mode: "box" | "violin",
  groupCol: number | null,
  valueCol: number,
  plotted: readonly number[],
  valueLabel: string,
  groupLabel: string,
): Promise<FacetDraw[]> {
  const compute = mode === "box" ? computeBoxDraw : computeViolinDraw;
  const rs = await Promise.all(
    slices.map(async (s): Promise<FacetDraw | null> => {
      const finiteGroups = resolveGroups(s.data, groupCol, valueCol, plotted).filter(
        (g) => g.values.length > 0,
      );
      if (!finiteGroups.length) return null;
      const draw = await compute(finiteGroups, valueLabel, groupLabel);
      // Export fidelity (GUI_INTERACTION #12 slice 4b): carry the raw groups
      // this draw was computed from so exportFigure can rebuild a faithful
      // per-facet request without a second resolveGroups pass.
      const rawGroups = finiteGroups.map((g) => ({ label: g.label, values: g.values }));
      return { label: s.label, draw, rawGroups };
    }),
  );
  return rs.filter((f): f is FacetDraw => f !== null);
}

export function useStatStage(params: UseStatStageParams): StatStageState {
  const { active, yKeys, xKey, seriesOrder, seed, onSeedConsumed } = params;

  const data = useMemo(() => analysisData(active), [active]);

  const columns = useMemo<StatColumn[]>(
    () => (active ? active.data.labels.map((lab, i) => ({ index: i, label: lab })) : []),
    [active],
  );
  const categoricalCols = useMemo<StatColumn[]>(() => {
    const cats = new Set(categoricalChannels(active));
    return columns.filter((c) => cats.has(c.index));
  }, [active, columns]);

  const plotted = useMemo(
    () =>
      active ? effectiveChannels(active.data, yKeys, xKey, active.channelRoles, seriesOrder) : [],
    [active, yKeys, xKey, seriesOrder],
  );

  const [mode, setMode] = useState<StatMode>("box");
  const [groupCol, setGroupColState] = useState<number | null>(null);
  const [valueCol, setValueCol] = useState<number>(0);
  const [dist, setDist] = useState("norm");
  const [bins, setBins] = useState<string>("fd");
  const [fit, setFit] = useState<string | null>(null);
  const [barStack, setBarStack] = useState(false);
  // Facet column (GUI_INTERACTION #11) — internal picker state, NOT a hook
  // param: background windows (params.seed === null) have no facet Picker
  // and never call setFacetCol, so they simply never facet.
  const [facetCol, setFacetColState] = useState<number | null>(null);

  // Re-derive the default picks whenever the active dataset changes — a
  // channel index from the PREVIOUS dataset would silently mis-group.
  useEffect(() => {
    const cats = categoricalChannels(active);
    const g = cats[0] ?? null;
    setGroupColState(g);
    setValueCol(firstValueChannel(active, g ?? -999));
    setFacetColState(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  // Cross-panel hook: the Graph Builder hands over the mode + pickers for a
  // box/violin/bar spec it "sent to stage" (mirrors the reflectivity SLD
  // seed). Declared AFTER the active-id reset so a same-dataset send wins.
  useEffect(() => {
    if (!seed) return;
    setMode(seed.mode);
    setGroupColState(seed.groupCol);
    setValueCol(seed.valueCol);
    setFacetColState(seed.facetCol ?? null);
    onSeedConsumed();
  }, [seed, onSeedConsumed]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [drawData, setDrawData] = useState<StatDrawData | null>(null);
  const [drawFacets, setDrawFacets] = useState<FacetDraw[] | null>(null);

  const groups = useMemo<GroupSpec[]>(() => {
    if (!data || (mode !== "box" && mode !== "violin")) return [];
    return resolveGroups(data, groupCol, valueCol, plotted);
  }, [data, mode, groupCol, valueCol, plotted]);

  const valueLabel = columns.find((c) => c.index === valueCol)?.label ?? (valueCol < 0 ? "x" : "value");
  const groupLabel =
    groupCol != null ? (columns.find((c) => c.index === groupCol)?.label ?? "group") : "channel";

  // Bar mode (gap #20): a category x series matrix, not a 1-D group list —
  // when a categorical column is picked, every PLOTTED channel becomes its
  // own clustered/stacked series within each category (buildBarMatrix);
  // otherwise fall back to one category per plotted channel (mirrors box/
  // violin's own fallback), each holding a single series. Purely local math
  // (lib/barlayout), no backend round-trip needed.
  const barValueChannels = useMemo(
    () => (plotted.length ? plotted : [valueCol]),
    [plotted, valueCol],
  );
  const barValueLabel = useMemo(() => {
    if (barValueChannels.length > 1) return "value";
    return columns.find((c) => c.index === barValueChannels[0])?.label ?? valueLabel;
  }, [barValueChannels, columns, valueLabel]);
  const barLabels = useMemo(
    () => barValueChannels.map((c) => columns.find((col) => col.index === c)?.label ?? `col ${c}`),
    [barValueChannels, columns],
  );
  const barData = useMemo<BarChartData | null>(() => {
    if (!data || mode !== "bar") return null;
    return computeBarData(data, groupCol, barValueChannels, barLabels, valueCol, plotted, barValueLabel);
  }, [data, mode, groupCol, barValueChannels, barLabels, valueCol, plotted, barValueLabel]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setNote(null);
    if (!data) {
      setDrawData(null);
      setDrawFacets(null);
      return;
    }

    // Faceted box/violin/bar (GUI_INTERACTION #11): one draw per facet-column
    // level instead of the flat single panel. The flat `draw` stays null
    // while faceted (see the StatStageState doc — `exportFigure` reads
    // `drawFacets` instead, GUI_INTERACTION #12 slice 4b).
    if (facetCol != null && (mode === "box" || mode === "violin" || mode === "bar")) {
      setDrawData(null);
      const slices = facetSlices(data, facetCol);
      const finishFacets = (results: FacetDraw[]) => {
        if (cancelled) return;
        if (results.length === 0) {
          setDrawFacets(null);
          setError("no finite values to group");
        } else {
          setDrawFacets(results);
          setNote(null);
        }
      };
      if (mode === "bar") {
        // Synchronous (no backend round-trip) — mirrors the flat bar branch
        // below, which also skips busy/cancelled bookkeeping.
        finishFacets(
          computeFacetBarDraws(
            slices,
            groupCol,
            barValueChannels,
            barLabels,
            valueCol,
            plotted,
            barValueLabel,
            barStack,
            groupLabel,
          ),
        );
        return () => {
          cancelled = true;
        };
      }
      setBusy(true);
      computeFacetGroupDraws(slices, mode, groupCol, valueCol, plotted, valueLabel, groupLabel)
        .then(finishFacets)
        .finally(() => !cancelled && setBusy(false));
      return () => {
        cancelled = true;
      };
    }
    setDrawFacets(null);

    if (mode === "box" || mode === "violin") {
      const finiteGroups = groups.filter((g) => g.values.length > 0);
      if (!finiteGroups.length) {
        setDrawData(null);
        setError("no finite values to group");
        return;
      }
      setBusy(true);
      if (mode === "box") {
        statsBox(
          finiteGroups.map((g) => g.values),
          finiteGroups.map((g) => g.label),
        )
          .then((r) => {
            if (cancelled) return;
            setDrawData({ mode: "box", boxes: r.boxes, valueLabel, groupLabel });
          })
          .catch(() => {
            if (cancelled) return;
            setDrawData({ mode: "box", boxes: groupBoxStatsClient(finiteGroups), valueLabel, groupLabel });
            setNote("backend unavailable — computed locally");
          })
          .finally(() => !cancelled && setBusy(false));
      } else {
        Promise.all(finiteGroups.map((g) => statsViolin(g.values)))
          .then((rs) => {
            if (cancelled) return;
            setDrawData({
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
            });
          })
          .catch(() => {
            if (cancelled) return;
            // Never fabricate a KDE offline — degrade to the exact same
            // stats Box mode would show for these groups.
            setDrawData({ mode: "box", boxes: groupBoxStatsClient(finiteGroups), valueLabel, groupLabel });
            setNote("violin (KDE) unavailable — showing box plot");
          })
          .finally(() => !cancelled && setBusy(false));
      }
    } else if (mode === "bar") {
      // Local/synchronous — no backend call, so no busy/cancelled bookkeeping.
      if (!barData || barData.groups.length === 0) {
        setDrawData(null);
        setError("no finite values to group");
        return;
      }
      setDrawData({ mode: "bar", data: barData, valueLabel: barValueLabel, groupLabel, stacked: barStack });
    } else if (mode === "qq") {
      const finite = finiteOf(data, valueCol);
      if (finite.length < 3) {
        setDrawData(null);
        setError("need ≥ 3 finite values");
        return;
      }
      setBusy(true);
      statsQQ(finite, dist)
        .then((r) => {
          if (cancelled) return;
          setDrawData({
            mode: "qq",
            theo: r.theoretical_quantiles,
            obs: r.sample_quantiles,
            slope: r.slope,
            intercept: r.intercept,
            dist: r.dist,
            valueLabel,
          });
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setDrawData(null);
          setError(e instanceof Error ? e.message : "Q-Q computation failed");
        })
        .finally(() => !cancelled && setBusy(false));
    } else {
      const finite = finiteOf(data, valueCol);
      if (finite.length < 2) {
        setDrawData(null);
        setError("need ≥ 2 finite values");
        return;
      }
      setBusy(true);
      statsHistogram(finite, bins, fit)
        .then((r) => {
          if (cancelled) return;
          const fitBlock = r.fit as Record<string, unknown> | undefined;
          setDrawData({
            mode: "histogram",
            edges: numArr(r.edges),
            counts: numArr(r.counts),
            density: Boolean(r.density),
            fit: fitBlock
              ? { dist: String(fitBlock.dist ?? fit), x: numArr(fitBlock.x), pdf: numArr(fitBlock.pdf) }
              : undefined,
            valueLabel,
          });
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setDrawData(null);
          setError(e instanceof Error ? e.message : "histogram computation failed");
        })
        .finally(() => !cancelled && setBusy(false));
    }

    return () => {
      cancelled = true;
    };
  }, [
    data,
    mode,
    groups,
    valueCol,
    dist,
    bins,
    fit,
    valueLabel,
    groupLabel,
    barData,
    barValueLabel,
    barStack,
    facetCol,
    groupCol,
    plotted,
    barValueChannels,
    barLabels,
  ]);

  async function exportFigure(fmt: string): Promise<void> {
    if (!data) return;
    // Faceted export (GUI_INTERACTION #12 slice 4b): drawFacets is set for
    // exactly the modes that facet (box/violin/bar) — see the useEffect
    // above. Checked before the flat branches below.
    if (drawFacets && drawFacets.length > 0) {
      await exportFacetedFigure(fmt);
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
        fmt,
        title: `${barValueLabel} by ${groupLabel}`,
        x_label: groupLabel,
        y_label: barValueLabel,
        filename: `bar_${barValueLabel}`,
      };
      await exportCategoricalFigure(spec);
      return;
    }
    const spec = buildExportSpec(mode, data, groups, valueCol, valueLabel, groupLabel, dist, bins, fit, fmt);
    if (spec) await exportStatplotFigure(spec);
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
  async function exportFacetedFigure(fmt: string): Promise<void> {
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

  return {
    hasData: !!active,
    mode,
    setMode,
    columns,
    categoricalCols,
    groupCol,
    setGroupCol: setGroupColState,
    valueCol,
    setValueCol,
    dist,
    setDist,
    bins,
    setBins,
    fit,
    setFit,
    barStack,
    setBarStack,
    facetCol,
    setFacetCol: setFacetColState,
    busy,
    error,
    note,
    draw: drawData,
    drawFacets,
    exportFigure,
  };
}

function buildExportSpec(
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
): StatplotFigureSpec | null {
  if (mode === "box" || mode === "violin") {
    const finiteGroups = groups.filter((g) => g.values.length > 0);
    if (!finiteGroups.length) return null;
    return {
      kind: mode,
      data: finiteGroups.map((g) => g.values),
      labels: finiteGroups.map((g) => g.label),
      fmt,
      title: `${valueLabel} by ${groupLabel}`,
      x_label: groupLabel,
      y_label: valueLabel,
      filename: `${mode}_${valueLabel}`,
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
