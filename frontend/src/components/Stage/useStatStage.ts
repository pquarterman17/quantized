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
// Faceting (GUI_INTERACTION #11 residual): Box/Violin/Strip/Bar can facet by a
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

import { statsHistogram, statsQQ } from "../../lib/api";
import { type BarChartData } from "../../lib/barlayout";
import { facetSlices } from "../../lib/facet";
import { effectiveChannels } from "../../lib/plotdata";
import { analysisView } from "../../lib/rowstate";
import type { GroupSpec } from "../../lib/statschooser";
import {
  categoricalChannels,
  finiteOf,
  resolveGroups,
  resolveGroupsIndexed,
  type IndexedGroupSpec,
} from "../../lib/statstage";
import type { StatMarksByMode, StatMarksMode } from "../../lib/plotviewSanitize";
import type { StatMarks } from "../../lib/statMarks";
import { statColorOf } from "../../lib/statColor";
import { needsBarRaw } from "./statBarMarks";
import { figureErrorNote } from "./statErrorNote";
import { applyLevels, levelAxes } from "./statStageLevels";
import { needsPoints, stageMarks, withMarks, withNestLabel } from "./statStageMarks";
import {
  computeBarData,
  computeBoxDraw,
  computeFacetBarDraws,
  computeFacetGroupDraws,
  computeStripDraw,
  computeViolinDraw,
  histogramDraw,
  qqDraw,
  type FacetDraw,
} from "./useStatStageCompute";
import { useStatStageDraws } from "./useStatStageDraws";
import { useStatStageExport } from "./useStatStageExport";
import { useStatStagePicks } from "./useStatStagePicks";
import type { StatColumn, StatStageState, UseStatStageParams } from "./useStatStageTypes";

export type { FacetDraw } from "./useStatStageCompute";
export type { StatColumn, StatStageState, UseStatStageParams } from "./useStatStageTypes";

export const DISTRIBUTIONS = ["norm", "logistic", "laplace", "uniform"] as const;
export const BIN_RULES = ["fd", "sturges", "scott", "rice", "sqrt", "auto"] as const;

export function useStatStage(params: UseStatStageParams): StatStageState {
  const { active, yKeys, xKey, seriesOrder, seed, onSeedConsumed } = params;
  const hideEmpty = params.hideEmptyLevels ?? false;
  const showN = params.showGroupN ?? true;

  // ONE `droppedRows` pass for both: `data` (every mode reads it) and
  // `rowIds`, the original dataset row behind each `data` row (null: nothing
  // dropped) — used only by the indexed-groups memo below, when box/strip
  // points are actually drawn. Two separate `analysisData`/`analysisRowIds`
  // calls used to re-derive the same exclusion ∪ filter Set twice per
  // `active` change regardless of mode; this computes it once.
  const { data, rowIds } = useMemo(() => analysisView(active), [active]);

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

  // Column picks + their defaults/seed/staleness rules — see
  // useStatStagePicks.ts. Declared HERE, at the position the state and the two
  // effects used to occupy, so its effects keep running before the compute
  // effect below.
  //
  // Only the MASKED picks are destructured: this hook's math and its returned
  // state both use them (the raw values exist so the mask can be reverted, and
  // are the picks hook's own business).
  const {
    mode, setMode,
    setGroupCol, setGroup2Col,
    valueCol, setValueCol,
    setFacetCol, colorCol, setColorCol,
    effectiveGroupCol, effectiveGroup2Col, effectiveFacetCol,
  } = useStatStagePicks({ active, categoricalCols, seed, onSeedConsumed });

  const [dist, setDist] = useState("norm");
  const [bins, setBins] = useState<string>("fd");
  const [fit, setFit] = useState<string | null>(null);
  const [barStack, setBarStack] = useState(false);
  // P2.6 box 1: the categorical marks (points / jitter / summary / error bars
  // / connect-means / labels) are the window's persisted `PlotView.statMarks`
  // when the caller passes them (focused stage + background windows), else
  // hook-local (a bare hook in a test). Display-only: they re-fetch nothing;
  // the only compute they reach is WHICH raw points to resolve (`needsPoints`).
  //
  // Review finding 6: stored and patched PER MODE (`StatMarksByMode`), never
  // as one flat object every mode read from alike — a choice made in one
  // mode (strip's `points: "none"`, say) must never read as another mode's
  // DEFAULT (box's fliers going dark too) purely because the two shared the
  // same stored fields. `marksMode` is null outside the four modes marks
  // apply to at all (qq/histogram); the hook still holds a slot for them in
  // `localMarks` so a mode switch never drops what was already set for one.
  const marksMode: StatMarksMode | null =
    mode === "box" || mode === "violin" || mode === "strip" || mode === "bar" ? mode : null;
  const [localMarks, setLocalMarks] = useState<StatMarksByMode>({});
  const marksByMode = params.marks ?? localMarks;
  const marks = marksMode ? marksByMode[marksMode] ?? null : null;
  const patchMarks = (patch: StatMarks, label?: string) => {
    if (!marksMode) return;
    if (params.onMarksChange) params.onMarksChange(marksMode, patch, label);
    else setLocalMarks((m) => ({ ...m, [marksMode]: { ...m[marksMode], ...patch } }));
  };
  const grouped = effectiveGroupCol != null;
  const rm = useMemo(() => stageMarks(mode, marks, grouped), [mode, marks, grouped]);
  const wantPoints = needsPoints(mode, rm);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Nesting (Group R) applies to the 1-D group list ONLY. Bar builds a
  // category x series MATRIX (lib/barlayout) whose category slots come from a
  // single column, and Q-Q/Histogram do not group at all — so a second factor
  // is inert in those modes. Gated here rather than in the mask because the
  // mask is mode-blind on purpose (it answers "is this pick still valid?",
  // not "does this mode use it?"); the toolbar hides the picker to match, so
  // the two never disagree about what is being shown.
  const nestCol =
    mode === "box" || mode === "violin" || mode === "strip" ? effectiveGroup2Col : null;
  // P1.4 Color-by: the factor (group, or the nest) whose level colours each glyph.
  const color = useMemo(
    () => (active && marksMode ? statColorOf(active.data, colorCol, effectiveGroupCol, nestCol) : null),
    [active, marksMode, colorCol, effectiveGroupCol, nestCol],
  );

  const groups = useMemo<GroupSpec[]>(() => {
    if (!data || (mode !== "box" && mode !== "violin" && mode !== "strip")) return [];
    return resolveGroups(data, effectiveGroupCol, valueCol, plotted, nestCol);
  }, [data, mode, effectiveGroupCol, valueCol, plotted, nestCol]);

  // Indexed groups (JMP_GAP J5 #1/#3): raw finite values + their ORIGINAL
  // dataset row index (`rowIds` maps the analysis view back, so a point's
  // jitter, on screen and in export, never moves when another row is
  // dropped), for the jittered points overlay -- only resolved when actually
  // needed (box's "show points" toggle, or strip mode which always shows
  // points) so an ordinary box/violin render skips this extra pass.
  const indexedGroups = useMemo<IndexedGroupSpec[]>(() => {
    if (!data || !wantPoints) return [];
    return resolveGroupsIndexed(data, effectiveGroupCol, valueCol, plotted, nestCol, rowIds);
  }, [data, rowIds, wantPoints, effectiveGroupCol, valueCol, plotted, nestCol]);

  const valueLabel = columns.find((c) => c.index === valueCol)?.label ?? (valueCol < 0 ? "x" : "value");
  const labelOf = (i: number | null): string | null =>
    i == null ? null : (columns.find((c) => c.index === i)?.label ?? "group");
  // Nested: "lot / wafer", matching the `lot = 1 / wafer = 3` tick convention
  // `statschooser.nestedLabel` writes, so the axis names both factors in the
  // same order and with the same separator the ticks below it use.
  const groupLabel =
    effectiveGroupCol != null
      ? [labelOf(effectiveGroupCol), labelOf(nestCol)].filter((l) => l != null).join(" / ")
      : "channel";
  // Review finding 4: the STRUCTURAL "is this axis nested" signal, stamped
  // on every draw (`nestLabel`) so a two-tier axis is never inferred from a
  // label's own text (`lib/statMarks.nestedTiers`'s doc).
  const nestLabel = nestCol != null ? labelOf(nestCol) : null;

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
  // P2.6 box 1: a grouped bar's points / median need each cell's raw rows.
  const barRaw = mode === "bar" && needsBarRaw(rm);
  const barData = useMemo<BarChartData | null>(() => {
    if (!data || mode !== "bar") return null;
    const raw = barRaw ? { rowIds } : null;
    return computeBarData(data, effectiveGroupCol, barValueChannels, barLabels, valueCol, plotted, barValueLabel, raw);
  }, [data, rowIds, barRaw, mode, effectiveGroupCol, barValueChannels, barLabels, valueCol, plotted, barValueLabel]);

  // P2.6 box 2: facet slices computed ONCE, shared by the compute effect and
  // the level axes; and every draw keyed to the grouping inputs it was
  // computed for, so a stale draw is never threaded onto a new axis.
  const slices = useMemo(
    () => (data && effectiveFacetCol != null ? facetSlices(data, effectiveFacetCol) : null),
    [data, effectiveFacetCol],
  );
  const drawKey = useMemo(
    () => ({ data, mode, effectiveGroupCol, nestCol, valueCol, plotted, barValueChannels, effectiveFacetCol }),
    [data, mode, effectiveGroupCol, nestCol, valueCol, plotted, barValueChannels, effectiveFacetCol],
  );
  const { drawData, drawFacets, fresh: { draw: freshDraw, facets: freshFacets }, setDrawData, setDrawFacets } =
    useStatStageDraws(drawKey);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setNote(null);
    if (!data) {
      setDrawData(null);
      setDrawFacets(null);
      return;
    }

    // Faceted box/violin/strip/bar (GUI_INTERACTION #11): one draw per facet-
    // column level instead of the flat single panel (with its own points). The flat `draw` stays null
    // while faceted (see the StatStageState doc — `exportFigure` reads
    // `drawFacets` instead, GUI_INTERACTION #12 slice 4b).
    if (effectiveFacetCol != null && marksMode) {
      setDrawData(null);
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
      if (marksMode === "bar") {
        // Synchronous (no backend round-trip) — mirrors the flat bar branch
        // below, which also skips busy/cancelled bookkeeping.
        finishFacets(
          computeFacetBarDraws(
            slices ?? [],
            effectiveGroupCol,
            barValueChannels,
            barLabels,
            valueCol,
            plotted,
            barValueLabel,
            barStack,
            groupLabel,
            barRaw ? { rowIds } : null,
          ),
        );
        return () => {
          cancelled = true;
        };
      }
      setBusy(true);
      void computeFacetGroupDraws(
        slices ?? [], marksMode, effectiveGroupCol, valueCol, plotted, valueLabel, groupLabel, nestCol, nestLabel,
        wantPoints ? { rowIds } : null,
      )
        .then(finishFacets)
        .finally(() => !cancelled && setBusy(false));
      return () => {
        cancelled = true;
      };
    }
    setDrawFacets(null);

    if (mode === "box" || mode === "violin" || mode === "strip") {
      const finiteGroups = groups.filter((g) => g.values.length > 0);
      if (!finiteGroups.length) {
        setDrawData(null);
        setError("no finite values to group");
        return;
      }
      // Same partition as `finiteGroups` (built from the SAME groupCol/
      // valueCol/plotted), so both filters drop exactly the same levels —
      // index-aligned with `finiteGroups`/`r.boxes` for the renderer.
      const finiteIndexedGroups = indexedGroups.filter((g) => g.points.length > 0);
      const pts = wantPoints ? finiteIndexedGroups : null;
      // The marks themselves (summary, error bars, connect-means, ...) are
      // stamped on after the compute (`withMarks`), so toggling one never
      // re-fetches the box stats.
      setBusy(true);
      if (mode === "box") {
        void computeBoxDraw(finiteGroups, valueLabel, groupLabel, pts)
          .then(({ draw, degraded }) => {
            if (cancelled) return;
            setDrawData(withNestLabel(draw, nestLabel));
            if (degraded) setNote("backend unavailable — computed locally");
          })
          .finally(() => !cancelled && setBusy(false));
      } else if (mode === "strip") {
        void computeStripDraw(finiteGroups, finiteIndexedGroups, valueLabel, groupLabel)
          .then(({ draw, degraded }) => {
            if (cancelled) return;
            setDrawData(withNestLabel(draw, nestLabel));
            if (degraded) setNote("backend unavailable — computed locally");
          })
          .finally(() => !cancelled && setBusy(false));
      } else {
        // Never fabricate a KDE offline — computeViolinDraw itself degrades
        // to the exact same box stats Box mode would show for these groups
        // (its `mode: "box"` on the returned draw IS the degrade signal).
        void computeViolinDraw(finiteGroups, valueLabel, groupLabel)
          .then((draw) => {
            if (cancelled) return;
            const withPoints = pts && (draw.mode === "violin" || draw.mode === "box") ? { ...draw, points: pts } : draw;
            setDrawData(withNestLabel(withPoints, nestLabel));
            if (draw.mode === "box") setNote("violin (KDE) unavailable — showing box plot");
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
        .then((r) => !cancelled && setDrawData(qqDraw(r, valueLabel)))
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
        .then((r) => !cancelled && setDrawData(histogramDraw(r, fit, valueLabel)))
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
    indexedGroups,
    wantPoints,
    barRaw,
    rowIds,
    marksMode,
    valueCol,
    dist,
    bins,
    fit,
    valueLabel,
    groupLabel,
    barData,
    barValueLabel,
    barStack,
    effectiveFacetCol,
    effectiveGroupCol,
    nestCol,
    nestLabel,
    plotted,
    barValueChannels,
    barLabels,
    slices,
    setDrawData,
    setDrawFacets,
  ]);

  // P2.6 box 2: thread the draws onto the full category axis (empty slots,
  // n captions) and build the notice — decoration only, see statStageLevels.
  // The axes depend on the data + picks alone, so they are memoized apart.
  const axes = useMemo(() => levelAxes({
    active, data, mode, groupCol: effectiveGroupCol, group2Col: nestCol, valueCol, plotted, barValueChannels, slices,
    facetCol: marksMode ? effectiveFacetCol : null,
  }), [active, data, mode, marksMode, effectiveGroupCol, nestCol, valueCol, plotted, barValueChannels, effectiveFacetCol, slices]);
  const levels = useMemo(
    () => applyLevels(axes, { hideEmpty, showN, color }, drawData, drawFacets, { draw: freshDraw, facets: freshFacets }),
    [axes, hideEmpty, showN, color, drawData, drawFacets, freshDraw, freshFacets],
  );
  const shown = useMemo(() => withMarks(levels.draw, levels.drawFacets, rm), [levels, rm]);
  // P2.6 box 1: the error-bar footnote, from the SAME draws the screen shows.
  const errorNote = useMemo(() => figureErrorNote(shown.draw, shown.drawFacets), [shown]);

  // Export reads ONE settled render: while the draw this mode reads is pending
  // it waits for the fresh one (useStatStageExport.ts), never mixing the two.
  const drawPending = effectiveFacetCol != null && marksMode ? !freshFacets : !freshDraw;
  const exportFigure = useStatStageExport(drawPending, data ? {
    data, mode, draw: shown.draw, drawFacets: shown.drawFacets, groups, indexedGroups, valueCol,
    valueLabel, groupLabel, barValueLabel, barStack, dist, bins, fit, marks: rm,
    showN, caveat: levels.notice?.caveat ?? null, errorNote, nestLabel,
  } : null);

  return {
    hasData: !!active,
    mode,
    setMode,
    columns,
    categoricalCols,
    groupCol: effectiveGroupCol,
    setGroupCol,
    // The MASKED nest, not the mode-gated `nestCol`: switching to Bar and back
    // must not silently forget the user's second factor, and the toolbar hides
    // the picker in Bar rather than showing it emptied.
    group2Col: effectiveGroup2Col,
    setGroup2Col,
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
    marks: rm,
    setMarks: patchMarks,
    facetCol: effectiveFacetCol,
    setFacetCol,
    colorCol: color?.col ?? null,
    setColorCol,
    busy,
    error,
    note,
    groupNotice: levels.notice,
    errorNote,
    draw: shown.draw,
    drawFacets: shown.drawFacets,
    exportFigure,
    axes,
  };
}
