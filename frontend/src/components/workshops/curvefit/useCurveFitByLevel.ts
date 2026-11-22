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
// answer for. The panel's weighting rides along per level: the sigma /
// weight column is a sibling channel of each level's sliced rows, resolved
// by dyForData (invalid weighting fails that level closed, never silent).
//
// Guard #11 is satisfied upstream: `data` is already the analysis view
// (lib/rowstate.analysisData), so every level below is post-exclusion/-filter.

import { useEffect, useMemo, useState } from "react";

import { fitModel } from "../../../lib/api";
import type { AnalysisResultValue } from "../../../lib/analysisResult";
import type { AnalysisSelectionItem } from "../../../lib/analysisSelection";
import { dyForData, weightRequestFields } from "../../../lib/fitweights";
import { ownXKey } from "../../../lib/perSeriesX";
import type { CalcResult, Dataset, DataStruct, FitWeighting } from "../../../lib/types";
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
  /** True only when `results` were fitted for exactly the current levels and
   *  settings and nothing is in flight: the only state a result may be saved from. */
  current: boolean;
  /** What "Save By result" records as provenance for these levels. */
  provenance: { parameters: Record<string, AnalysisResultValue>; xKey: number | null; yKeys: number[]; rowIds: number[] | null; range: AnalysisSelectionItem["range"] };
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

/** A bound / start value as a saved setting: ±Infinity and NaN become named strings
 *  (a result's settings cannot hold them), so "unbounded" survives the save. */
const encodeNumber = (v: number): number | string => (Number.isFinite(v) ? v : Number.isNaN(v) ? "nan" : v > 0 ? "inf" : "-inf");

export function useCurveFitByLevel(
  active: Dataset | null,
  data: DataStruct | null,
  columns: readonly ByColumnOption[],
  modelName: string,
  xKey: number | null,
  yKey: number | null,
  start: CurveFitByLevelStart | undefined,
  weight: FitWeighting | undefined = undefined,
  initialByCol: number | null = null,
  selected: AnalysisSelectionItem | null = null,
): CurveFitByLevelState {
  const byPartition = useByPartition(active, data, columns, initialByCol);
  const [results, setResults] = useState<CurveFitLevelResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [ranFor, setRanFor] = useState<unknown[] | null>(null);

  useEffect(() => {
    if (byPartition.levels.length === 0 || yKey == null) {
      setResults([]);
      setRanFor(null);
      setBusy(false);
      return;
    }
    let cancelled = false;
    // Aborts the fits still in flight when the inputs change or the panel closes
    // (the `byrun` runner does the same), instead of leaving them to finish unseen.
    const controller = new AbortController();
    const ranInputs = [byPartition.levels, modelName, xKey, yKey, start, active, weight];
    setBusy(true);
    void Promise.all(
      byPartition.levels.map(async (lvl): Promise<CurveFitLevelResult> => {
        const fitX = active ? ownXKey(active, xKey, yKey) : xKey; // a secondary-X Y fits against its own X
        const xv = fitX == null ? lvl.data.time : lvl.data.values.map((row) => row[fitX]);
        const yv = lvl.data.values.map((row) => row[yKey]);
        const n = Math.min(xv.length, yv.length);
        const x: number[] = [];
        const y: number[] = [];
        const keep: number[] = [];
        for (let i = 0; i < n; i++) {
          if (Number.isFinite(xv[i]) && Number.isFinite(yv[i])) {
            x.push(xv[i]);
            y.push(yv[i]);
            keep.push(i);
          }
        }
        // Weighted levels: the sigma / weight column rides along in the
        // level's own rows. Fail closed — a level whose weighting is invalid
        // reports an error instead of silently fitting unweighted.
        let wfields: ReturnType<typeof weightRequestFields> = {};
        if (weight && weight.mode !== "none") {
          const { dy, issue } = dyForData(lvl.data, yKey, weight, keep);
          if (!dy) {
            return { label: lvl.label, n: x.length, result: null, error: issue ? `${issue.replace(/ — fitting unweighted$/, "")} — this level was not fitted` : "weighting unavailable for this level — this level was not fitted" };
          }
          wfields = weightRequestFields(weight, keep.map((i) => dy[i]));
        }
        try {
          const result = await fitModel({
            model: modelName,
            x,
            y,
            ...wfields,
            ...(start
              ? {
                  p0: start.p0,
                  lower: start.lower,
                  upper: start.upper,
                  ...(start.fixed.some(Boolean) ? { fixed: start.fixed } : {}),
                }
              : {}),
          }, controller.signal);
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
        if (!cancelled) {
          setResults(r);
          setRanFor(ranInputs);
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [byPartition.levels, modelName, xKey, yKey, start, active, weight]);

  const { byOptions, byCol, setByCol, levels, totalLevels } = byPartition;
  const inputsNow = [byPartition.levels, modelName, xKey, yKey, start, active, weight];
  const current = !busy && ranFor !== null && ranFor.every((v, i) => v === inputsNow[i]);
  const provenance = useMemo(() => ({
    parameters: { model: modelName, weighting: weight ? { ...weight } : null, customStart: start !== undefined, ...(start ? { start: { p0: start.p0.map(encodeNumber), lower: start.lower.map(encodeNumber), upper: start.upper.map(encodeNumber), fixed: start.fixed } } : {}) },
    xKey, yKeys: yKey == null ? [] : [yKey], rowIds: selected?.rowIds ?? null, range: selected?.range ?? null,
  }), [modelName, weight, start, selected, xKey, yKey]);
  return { byOptions, byCol, setByCol, levels, totalLevels, results, busy, current, provenance };
}
