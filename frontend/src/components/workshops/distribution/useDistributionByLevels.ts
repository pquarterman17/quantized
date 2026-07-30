// Distribution "By" grouping (JMP_GAP J7) — the per-level half of the
// Distribution platform, extracted from useDistribution.ts (2026-07-29,
// JMP_GAP #14: that hook reached 583 lines in the `.ts` gap where neither
// the .tsx component ceiling nor the store pins reach).
//
// This module owns the PER-LEVEL ANALYSIS PRIMITIVES — how a column's values
// are pulled (`colValues`), how a wire array is coerced (`numArr`), and what
// one histogram/descriptive/normality result looks like (`HistBins` /
// `Normality` / `DistributionLevelResult`). The un-partitioned view in
// useDistribution is the n=1 case of exactly this computation, which is why
// it uses the same pieces; useDistribution re-exports these types so the
// panel components (HistogramStrip, DistributionLevelSection) keep their
// existing `from "./useDistribution"` imports.
//
// Guard #11 is satisfied upstream: `data` is already the analysis view
// (lib/rowstate.analysisData), so every level below is post-exclusion and
// post-filter. Render-only, like useByPartition itself — a By level never
// writes the shared row selection (unlike the single-column histogram's
// `brushBins`, which deliberately does).

import { useEffect, useState } from "react";

import { statsDescriptive, statsHistogram, statsShapiro } from "../../../lib/api";
import type { CalcResult, Dataset, DataStruct } from "../../../lib/types";
import { type ByColumnOption, type ByLevel, useByPartition } from "../useByPartition";

export interface HistBins {
  counts: number[];
  centers: number[];
  edges: number[];
}

export interface Normality {
  W: number;
  p: number;
  N: number;
}

/** One By-level's rendering — the same shape (hist/desc/norm/normNote) the
 *  un-partitioned view keeps as separate fields, bundled per level so
 *  DistributionLevelSection can render it with one prop. `error` is set
 *  instead of thrown when a level has too few finite values to bin — an
 *  honest line, not a crash (JMP_GAP J7 acceptance). */
export interface DistributionLevelResult {
  label: string;
  n: number;
  hist: HistBins | null;
  desc: CalcResult | null;
  norm: Normality | null;
  normNote: string | null;
  error: string | null;
}

export interface DistributionByLevelsState {
  /** Categorical columns eligible as a By column. */
  byOptions: ByColumnOption[];
  /** null = no By column (the caller's single un-partitioned view is live). */
  byCol: number | null;
  setByCol: (i: number | null) => void;
  /** One ByLevel per level of `byCol`, ascending; [] when `byCol` is null. */
  levels: ByLevel[];
  /** Uncapped level count — > levels.length means the partition was
   *  truncated at BY_MAX_LEVELS and the panel must say so. */
  totalLevels: number;
  /** Parallel to `levels` once its fetches settle (histogram+stats+normality
   *  per level, the SAME trio the un-partitioned view runs). */
  results: DistributionLevelResult[];
  /** True while any per-level fetch in `results` is still in flight. */
  busy: boolean;
}

/** Column values as a plain number array; `index < 0` means the x/time axis. */
export const colValues = (data: DataStruct, index: number): number[] =>
  index < 0 ? data.time : data.values.map((row) => row[index]);

/** Wire array -> number[]; anything non-array degrades to empty rather than
 *  throwing, so one malformed field can't take down the whole panel. */
export const numArr = (v: unknown): number[] =>
  Array.isArray(v) ? v.map((x) => Number(x)) : [];

/** The normality-unavailable line, derived from the finite N the backend
 *  keys its Shapiro range off (n<3 or n>5000). Shared by both the
 *  un-partitioned view and each By level so the wording can't drift. */
export function normalityNote(n: number): string {
  if (n < 3) return "need ≥ 3 values";
  if (n > 5000) return "n > 5000 (Shapiro limit)";
  return "normality test unavailable";
}

/** `columns` is the caller's own `{index, label}[]` picker list, ALREADY
 *  filtered of the profiled column itself — partitioning a column by its own
 *  levels is degenerate (every level would hold one homogeneous value).
 *  `col` is the profiled column, used both for that guard's reset and as the
 *  channel each level's trio runs on. */
export function useDistributionByLevels(
  active: Dataset | null,
  data: DataStruct | null,
  columns: readonly ByColumnOption[],
  col: number,
): DistributionByLevelsState {
  const byPartition = useByPartition(active, data, columns);
  const [results, setResults] = useState<DistributionLevelResult[]>([]);
  const [busy, setBusy] = useState(false);

  // A By column picked before `col` changed underneath it (now colliding
  // with the new profiled column) resets to none.
  const { byCol, setByCol } = byPartition;
  useEffect(() => {
    if (byCol === col) setByCol(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [col]);

  // One histogram/descriptive/Shapiro fetch per By level, the SAME trio the
  // un-partitioned view runs, on that level's own sliced DataStruct
  // (useByPartition already partitioned the analysis view).
  useEffect(() => {
    if (byPartition.levels.length === 0) {
      setResults([]);
      setBusy(false);
      return;
    }
    let cancelled = false;
    setBusy(true);
    Promise.all(
      byPartition.levels.map(async (lvl): Promise<DistributionLevelResult> => {
        const vals = colValues(lvl.data, col).filter((v) => Number.isFinite(v));
        const [h, d, s] = await Promise.allSettled([
          statsHistogram(vals),
          statsDescriptive(vals),
          statsShapiro(vals),
        ]);
        const levelHist =
          h.status === "fulfilled"
            ? { counts: numArr(h.value.counts), centers: numArr(h.value.centers), edges: numArr(h.value.edges) }
            : null;
        const levelNorm =
          s.status === "fulfilled" && Number.isFinite(Number(s.value.p))
            ? { W: Number(s.value.W), p: Number(s.value.p), N: Number(s.value.N) }
            : null;
        return {
          label: lvl.label,
          n: vals.length,
          hist: levelHist,
          desc: d.status === "fulfilled" ? d.value : null,
          norm: levelNorm,
          normNote: levelNorm ? null : normalityNote(vals.length),
          error: levelHist ? null : `not enough data (n=${vals.length})`,
        };
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
  }, [byPartition.levels, col]);

  const { byOptions, levels, totalLevels } = byPartition;
  return { byOptions, byCol, setByCol, levels, totalLevels, results, busy };
}
