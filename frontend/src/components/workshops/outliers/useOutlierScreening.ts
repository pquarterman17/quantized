// Outlier Screening workshop (JMP_GAP_PLAN J9 residual) — state hook. Picks a
// (continuous) channel of the active dataset's ANALYSIS view
// (lib/rowstate.analysisData, guard #11) and runs one of the four existing
// backend tests (Grubbs / Rosner / Dixon Q / MAD, calc.stats_outliers via
// routes/stats_outliers.py) against it — this hook only ever SCREENS and
// REPORTS, never excludes: "Select flagged rows" writes the shared #50
// `selection` (mirrors the plot brush in Stage/usePlotStageActions.ts and
// the Distribution workshop's histogram-bin brushing) so the analyst reviews
// the flagged points before choosing the existing exclude/keep-only actions.
//
// Row-index mapping: every backend test reports `flagged_indices` as
// positions in the array IT WAS SENT — this hook always sends the full
// pruned column (`colValues(data, col)`, finite AND non-finite; each test
// filters to finite internally, see `calc.stats_outliers._clean_indexed`),
// so a flagged index is a PRUNED-row position. `activeRowIndices` (the
// analysis view's own kept-index list) expands that to the ORIGINAL dataset
// row index — the exact technique `useDistribution`'s `rowsInBins` mapping
// uses for histogram-bar brushing, applied to a flat index list instead of a
// bin-membership scan.

import { useEffect, useMemo, useState } from "react";

import { statsDixonQ, statsGrubbs, statsMadOutliers, statsRosner, type OutlierDixonResult, type OutlierGrubbsResult, type OutlierMadResult, type OutlierRosnerResult } from "../../../lib/api";
import { channelModelingType, isCategorical } from "../../../lib/modeling";
import { activeRowIndices, analysisData, droppedRows } from "../../../lib/rowstate";
import type { DataStruct } from "../../../lib/types";
import type { OutlierScreeningRecipe, OutlierScreeningSnapshot } from "../../../lib/outlierScreeningAnalysisResult";
import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { useFollowColumnPicks } from "../useFollowColumnPicks";
import { useOutlierScreeningResultBridge } from "./useOutlierScreeningResultBridge";

export type OutlierMethod = "grubbs" | "rosner" | "dixon-q" | "mad";

export const OUTLIER_METHODS: { value: OutlierMethod; label: string }[] = [
  { value: "grubbs", label: "Grubbs (single outlier)" },
  { value: "rosner", label: "Rosner ESD (up to k outliers)" },
  { value: "dixon-q", label: "Dixon Q (small sample, 3–30)" },
  { value: "mad", label: "Robust MAD (modified z-score)" },
];

export interface OutlierColumn {
  index: number;
  label: string;
}

export type OutlierResult =
  | { method: "grubbs"; data: OutlierGrubbsResult }
  | { method: "rosner"; data: OutlierRosnerResult }
  | { method: "dixon-q"; data: OutlierDixonResult }
  | { method: "mad"; data: OutlierMadResult };

export interface OutlierScreeningState {
  hasData: boolean;
  columns: OutlierColumn[];
  col: number;
  setCol: (i: number) => void;
  method: OutlierMethod;
  setMethod: (m: OutlierMethod) => void;
  /** Rosner only: max outliers to test for. */
  k: number;
  setK: (k: number) => void;
  /** MAD only: modified-z-score flag threshold. */
  threshold: number;
  setThreshold: (t: number) => void;
  /** Grubbs/Rosner/Dixon: significance level. */
  alpha: number;
  setAlpha: (a: number) => void;
  busy: boolean;
  error: string | null;
  result: OutlierResult | null;
  /** ORIGINAL dataset row indices for the current result's flagged points —
   *  what "Select flagged rows" writes to the shared selection. Empty when
   *  there's no result or nothing was flagged. */
  flaggedRowIndices: number[];
  /** ORIGINAL-row-indexed (value, isFlagged) pairs for the picked column —
   *  the panel's "flagged row values" table. */
  flaggedRowValues: { rowIndex: number; value: number }[];
  /** Writes `flaggedRowIndices` to the shared #50 selection (never excludes
   *  or deletes anything itself — a no-op when nothing is flagged). */
  selectFlaggedRows: () => void;
  canSaveResult: boolean;
  saveResultDisabledReason: string | null;
  saveResult: () => string | null;
}

const colValues = (data: DataStruct, index: number): number[] =>
  index < 0 ? data.time : data.values.map((row) => row[index]);

/** First continuous channel, else the first channel, else 0 — mirrors the
 *  Fit Y by X / Tabulate workshops' own default picker. */
function firstContinuous(active: ReturnType<typeof useActiveDataset>): number {
  if (!active) return 0;
  const n = active.data.labels.length;
  for (let i = 0; i < n; i++) {
    if (!isCategorical(channelModelingType(active, i))) return i;
  }
  return n ? 0 : -1;
}

export function useOutlierScreening(): OutlierScreeningState {
  const active = useActiveDataset();
  const setRowSelection = useApp((s) => s.setRowSelection);
  const data = useMemo(() => analysisData(active), [active]);

  const columns = useMemo<OutlierColumn[]>(() => {
    if (!active) return [];
    const xName = String(active.data.metadata?.["x_column_name"] ?? "x");
    return [
      { index: -1, label: xName },
      ...active.data.labels.map((lab, i) => ({ index: i, label: lab })),
    ];
  }, [active]);

  const [col, setCol] = useState<number>(() => firstContinuous(active));
  const [method, setMethod] = useState<OutlierMethod>("grubbs");
  const [k, setK] = useState(2);
  const [threshold, setThreshold] = useState(3.5);
  const [alpha, setAlpha] = useState(0.05);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OutlierResult | null>(null);
  const [resultKey, setResultKey] = useState<string | null>(null);

  // Re-derive the default column whenever the active dataset changes — a
  // channel index from the PREVIOUS dataset would silently screen the wrong
  // column (mirrors useStatStage's identical reset-on-dataset-change effect).
  useEffect(() => {
    setCol(firstContinuous(active));
    setResult(null);
    setResultKey(null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);
  // A column added/removed under a pick follows it by label (../useFollowColumnPicks).
  useFollowColumnPicks(active, (follow) => {
    const next = follow(col);
    if (next !== col) setCol(next ?? firstContinuous(active));
  });

  const values = useMemo(() => (data ? colValues(data, col) : []), [data, col]);
  const recipe = useMemo<OutlierScreeningRecipe>(() => ({ col, method, alpha, k, threshold }),
    [alpha, col, k, method, threshold]);
  const sourceFingerprint = useMemo(() => active && !active.pending ? analysisDataFingerprint(active) : "pending",
    [active]);
  const runKey = `${sourceFingerprint}:${col}:${method}:${method === "mad" ? threshold : alpha}:${method === "rosner" ? k : ""}`;

  useEffect(() => {
    if (!data || values.length === 0) {
      setResult(null);
      setResultKey(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setBusy(true);
    setError(null);

    async function run(): Promise<void> {
      try {
        if (method === "grubbs") {
          const r = await statsGrubbs(values, alpha);
          if (!cancelled) { setResult({ method: "grubbs", data: r }); setResultKey(runKey); }
        } else if (method === "rosner") {
          const r = await statsRosner(values, k, alpha);
          if (!cancelled) { setResult({ method: "rosner", data: r }); setResultKey(runKey); }
        } else if (method === "dixon-q") {
          const r = await statsDixonQ(values, alpha);
          if (!cancelled) { setResult({ method: "dixon-q", data: r }); setResultKey(runKey); }
        } else {
          const r = await statsMadOutliers(values, threshold);
          if (!cancelled) { setResult({ method: "mad", data: r }); setResultKey(runKey); }
        }
      } catch (e) {
        if (!cancelled) {
          setResult(null);
          setResultKey(null);
          setError(e instanceof Error ? e.message : "outlier screening failed");
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [data, values, method, k, threshold, alpha, runKey]);

  // Pruned-row -> ORIGINAL-row index map (the useDistribution.rowsInBins
  // technique): `kept[prunedIndex] === originalRowIndex`.
  const kept = useMemo(
    () => (active ? activeRowIndices(active.data.time.length, droppedRows(active)) : []),
    [active],
  );

  const prunedFlagged = useMemo<number[]>(() => {
    if (!result || resultKey !== runKey) return [];
    return result.data.flagged_indices;
  }, [result, resultKey, runKey]);

  const flaggedRowIndices = useMemo(
    () => prunedFlagged.map((i) => kept[i]).filter((i): i is number => i != null),
    [prunedFlagged, kept],
  );

  const flaggedRowValues = useMemo(
    () =>
      prunedFlagged
        .map((i) => ({ rowIndex: kept[i], value: values[i] }))
        .filter((p): p is { rowIndex: number; value: number } => p.rowIndex != null),
    [prunedFlagged, kept, values],
  );

  const resultCurrent = !!result && resultKey === runKey;
  const snapshot = useMemo<OutlierScreeningSnapshot | null>(() => {
    if (!result || !resultCurrent) return null;
    const scoreAt = (i: number): number | null => result.method === "mad"
      ? result.data.modified_z_scores[i] ?? null : null;
    return {
      channelLabel: columns.find((column) => column.index === col)?.label ?? `column ${col}`,
      result,
      flaggedRows: prunedFlagged.map((i) => ({ rowIndex: kept[i], value: values[i], score: scoreAt(i) }))
        .filter((row): row is { rowIndex: number; value: number; score: number | null } =>
          row.rowIndex != null && Number.isFinite(row.value)),
      omittedRows: result.data.excluded_indices.map((i) => kept[i]).filter((i): i is number => i != null),
      rosnerSteps: result.method === "rosner" ? result.data.table.map((row) => ({
        step: row.i, statistic: row.R, critical: row.lambda_critical,
        rowIndex: kept[row.index] ?? null, value: row.value, exceeds: row.exceeds,
      })) : [],
    };
  }, [col, columns, kept, prunedFlagged, result, resultCurrent, values]);

  const resultBridge = useOutlierScreeningResultBridge({
    active, recipe, setCol, setMethod, setAlpha, setK, setThreshold,
    snapshot, busy, resultCurrent,
  });

  function selectFlaggedRows(): void {
    if (flaggedRowIndices.length === 0) return;
    setRowSelection(flaggedRowIndices);
  }

  return {
    hasData: !!active,
    columns,
    col,
    setCol,
    method,
    setMethod,
    k,
    setK,
    threshold,
    setThreshold,
    alpha,
    setAlpha,
    busy,
    error,
    result: resultCurrent ? result : null,
    flaggedRowIndices,
    flaggedRowValues,
    selectFlaggedRows,
    ...resultBridge,
  };
}
