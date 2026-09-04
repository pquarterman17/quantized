// Curve Fit "By" grouping (JMP_GAP_PLAN J7 residual — Distribution and Fit Y
// by X shipped By, curve fit was the noted gap) — a sibling module rather
// than growing useCurveFit.ts (which already carries model selection,
// weighting, the params editor, corner plot, find X/Y), mirroring the
// useDistributionByLevels.ts pattern.
//
// Levels are DISPLAY-ONLY (the useByPartition convention): each level's fit
// result renders in its own section, but none of it touches the shared plot
// overlay, the recorded macro/pipeline step, or the durable FitSpec — those
// are singleton per-dataset concepts a multi-level fan-out has no single
// answer for. Weighting is also scoped out for v1: every level fits
// UNWEIGHTED regardless of the panel's weight mode (dyForFit needs a Dataset
// + its exclusion state, which a level's bare sliced DataStruct doesn't
// carry) — disclosed by the panel, not hidden.
//
// Guard #11 is satisfied upstream: `data` is already the analysis view
// (lib/rowstate.analysisData), so every level below is post-exclusion/-filter.

import { useEffect, useState } from "react";

import { fitModel } from "../../../lib/api";
import type { CalcResult, Dataset, DataStruct } from "../../../lib/types";
import { type ByColumnOption, type ByLevel, useByPartition } from "../useByPartition";

export interface CurveFitLevelResult {
  label: string;
  n: number;
  result: CalcResult | null;
  /** Set instead of a result when the level had too few/invalid points for
   *  the model to fit — an honest line, not a thrown error (JMP_GAP_PLAN J7
   *  acceptance). */
  error: string | null;
}

export interface CurveFitByLevelState {
  byOptions: ByColumnOption[];
  byCol: number | null;
  setByCol: (i: number | null) => void;
  levels: ByLevel[];
  totalLevels: number;
  results: CurveFitLevelResult[];
  busy: boolean;
}

/** Custom starting values / bounds / fixed flags (MAIN_PLAN #30). When the
 *  user edited the parameter table these ride along to EVERY level unchanged
 *  — the "a pinned start applies everywhere" reading; `undefined` (table
 *  untouched) lets each level resolve the registry model's own defaults,
 *  exactly like the un-partitioned Fit button does today. */
export interface CurveFitByLevelStart {
  p0: number[];
  lower: number[];
  upper: number[];
  fixed: boolean[];
}

export function useCurveFitByLevel(
  active: Dataset | null,
  data: DataStruct | null,
  columns: readonly ByColumnOption[],
  modelName: string,
  xKey: number | null,
  yKey: number | null,
  start: CurveFitByLevelStart | undefined,
): CurveFitByLevelState {
  const byPartition = useByPartition(active, data, columns);
  const [results, setResults] = useState<CurveFitLevelResult[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (byPartition.levels.length === 0 || yKey == null) {
      setResults([]);
      setBusy(false);
      return;
    }
    let cancelled = false;
    setBusy(true);
    void Promise.all(
      byPartition.levels.map(async (lvl): Promise<CurveFitLevelResult> => {
        const xv = xKey == null ? lvl.data.time : lvl.data.values.map((row) => row[xKey]);
        const yv = lvl.data.values.map((row) => row[yKey]);
        const n = Math.min(xv.length, yv.length);
        const x: number[] = [];
        const y: number[] = [];
        for (let i = 0; i < n; i++) {
          if (Number.isFinite(xv[i]) && Number.isFinite(yv[i])) {
            x.push(xv[i]);
            y.push(yv[i]);
          }
        }
        try {
          const result = await fitModel({
            model: modelName,
            x,
            y,
            ...(start
              ? {
                  p0: start.p0,
                  lower: start.lower,
                  upper: start.upper,
                  ...(start.fixed.some(Boolean) ? { fixed: start.fixed } : {}),
                }
              : {}),
          });
          return { label: lvl.label, n: x.length, result, error: null };
        } catch (e) {
          return {
            label: lvl.label,
            n: x.length,
            result: null,
            error: e instanceof Error ? e.message : `not enough data (n=${x.length})`,
          };
        }
      }),
    )
      .then((r) => {
        if (!cancelled) setResults(r);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [byPartition.levels, modelName, xKey, yKey, start]);

  const { byOptions, byCol, setByCol, levels, totalLevels } = byPartition;
  return { byOptions, byCol, setByCol, levels, totalLevels, results, busy };
}
