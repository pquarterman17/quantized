// Generic "By" runner for single-curve tools (Find Peaks, Peak analyzer,
// Baseline, Signal Processing): pick a categorical column, run the tool's own
// computation once per level, collect one summary row per level. The pattern of
// curvefit/useCurveFitByLevel.ts and distribution/useDistributionByLevels.ts,
// factored so each tool supplies only `run` (one level -> summary cells).
//
// DISPLAY-ONLY, like those: nothing here touches the plot overlay, a recorded
// pipeline step or a result record, and a level whose run throws is an honest
// error row, never a thrown exception or a silent skip. `data` must already be
// the analysis view (lib/rowstate.analysisData; guard #11).

import { useEffect, useRef, useState } from "react";

import type { Dataset, DataStruct } from "../../../lib/types";
import { type ByColumnOption, type ByLevel, useByPartition } from "../useByPartition";

export type ByCell = string | number | null;

export interface ByLevelRow {
  label: string;
  n: number;
  /** One cell per summary column; empty when `error` is set. */
  values: ByCell[];
  error: string | null;
}

export interface ByLevelRunState {
  byOptions: ByColumnOption[];
  byCol: number | null;
  setByCol: (i: number | null) => void;
  totalLevels: number;
  levels: ByLevel[];
  rows: ByLevelRow[];
  busy: boolean;
  /** True only when `rows` were computed for exactly the current levels and
   *  `runKey` and nothing is in flight: the only state a result may be saved from. */
  current: boolean;
}

/** `run` may read the latest tool settings through closure: it is held in a ref
 *  and only `runKey` (a string that changes whenever a setting the result
 *  depends on does) re-triggers the per-level runs. Include every input in it. */
export function useByLevelRun(
  active: Dataset | null,
  data: DataStruct | null,
  columns: readonly ByColumnOption[],
  run: (level: ByLevel, signal: AbortSignal) => Promise<ByCell[]>,
  runKey: string,
): ByLevelRunState {
  const part = useByPartition(active, data, columns);
  const [rows, setRows] = useState<ByLevelRow[]>([]);
  const [ranFor, setRanFor] = useState<{ levels: ByLevel[]; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const runRef = useRef(run);
  runRef.current = run;
  // A By column the caller no longer offers (it became the analysed column,
  // say) resets to none instead of partitioning by the analysed column.
  const { byCol, byOptions, setByCol } = part;
  useEffect(() => {
    if (byCol !== null && !byOptions.some((option) => option.index === byCol)) setByCol(null);
  }, [byCol, byOptions, setByCol]);

  useEffect(() => {
    if (part.levels.length === 0) {
      setRows([]);
      setRanFor(null);
      setBusy(false);
      return;
    }
    const controller = new AbortController();
    const levels = part.levels;
    const key = runKey;
    setBusy(true);
    void Promise.all(
      part.levels.map(async (level): Promise<ByLevelRow> => {
        try {
          const values = await runRef.current(level, controller.signal);
          return { label: level.label, n: level.rowIndexes.length, values, error: null };
        } catch (e) {
          return { label: level.label, n: level.rowIndexes.length, values: [], error: e instanceof Error ? e.message : "failed" };
        }
      }),
    ).then((result) => {
      if (!controller.signal.aborted) {
        setRows(result);
        setRanFor({ levels, key });
        setBusy(false);
      }
    });
    return () => controller.abort();
  }, [part.levels, runKey]);

  const current = !busy && ranFor !== null && ranFor.levels === part.levels && ranFor.key === runKey;
  return { byOptions: part.byOptions, byCol: part.byCol, setByCol: part.setByCol, totalLevels: part.totalLevels, levels: part.levels, rows, busy, current };
}
