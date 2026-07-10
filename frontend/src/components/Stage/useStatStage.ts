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

import { useEffect, useMemo, useState } from "react";

import { buildBarMatrix, seriesStat, type BarChartData } from "../../lib/barlayout";
import {
  exportCategoricalFigure,
  exportStatplotFigure,
  statsBox,
  statsHistogram,
  statsQQ,
  statsViolin,
  type CategoricalFigureSpec,
  type StatplotFigureSpec,
} from "../../lib/api";
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
  busy: boolean;
  error: string | null;
  /** Non-fatal note (e.g. an offline degrade) shown alongside the plot. */
  note: string | null;
  draw: StatDrawData | null;
  /** Builds the same-shape request the interactive stage saw, for the
   *  "Export figure" button (null when there's nothing to export yet). */
  exportFigure: (fmt: string) => Promise<void>;
}

const colValues = (data: DataStruct, index: number): number[] =>
  index < 0 ? data.time : data.values.map((row) => row[index]);

const finiteOf = (data: DataStruct, index: number): number[] =>
  colValues(data, index).filter((v) => Number.isFinite(v));

function numArr(v: unknown): number[] {
  return Array.isArray(v) ? v.map((x) => Number(x)) : [];
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

  // Re-derive the default picks whenever the active dataset changes — a
  // channel index from the PREVIOUS dataset would silently mis-group.
  useEffect(() => {
    const cats = categoricalChannels(active);
    const g = cats[0] ?? null;
    setGroupColState(g);
    setValueCol(firstValueChannel(active, g ?? -999));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  // Cross-panel hook: the Graph Builder hands over the mode + pickers for a
  // box/violin spec it "sent to stage" (mirrors the reflectivity SLD seed).
  // Declared AFTER the active-id reset so a same-dataset send wins over it.
  useEffect(() => {
    if (!seed) return;
    setMode(seed.mode);
    setGroupColState(seed.groupCol);
    setValueCol(seed.valueCol);
    onSeedConsumed();
  }, [seed, onSeedConsumed]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [drawData, setDrawData] = useState<StatDrawData | null>(null);

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
  const barData = useMemo<BarChartData | null>(() => {
    if (!data || mode !== "bar") return null;
    if (groupCol != null) {
      const labels = barValueChannels.map((c) => columns.find((col) => col.index === c)?.label ?? `col ${c}`);
      return buildBarMatrix(data, groupCol, barValueChannels, labels);
    }
    const fallbackGroups = resolveGroups(data, null, valueCol, plotted);
    return {
      groups: fallbackGroups.map((g) => ({ label: g.label, series: [seriesStat(g.values)] })),
      seriesLabels: [barValueLabel],
    };
  }, [data, mode, groupCol, barValueChannels, columns, valueCol, plotted, barValueLabel]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setNote(null);
    if (!data) {
      setDrawData(null);
      return;
    }

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
  }, [data, mode, groups, valueCol, dist, bins, fit, valueLabel, groupLabel, barData, barValueLabel, barStack]);

  async function exportFigure(fmt: string): Promise<void> {
    if (!data) return;
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
    busy,
    error,
    note,
    draw: drawData,
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
