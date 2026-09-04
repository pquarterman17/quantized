// Distribution platform (ORIGIN_GAP #52) — state hook. For one column of the
// active dataset it composes three already-golden backends: a histogram
// (/api/statplots/histogram), descriptive stats (/api/stats/descriptive), and
// a Shapiro-Wilk normality test (/api/stats/shapiro). Reads the dataset's
// ANALYSIS view (rowstate.analysisData) so excluded rows (#50) drop from the
// distribution. The three calls are settled independently: a Shapiro n-range
// failure (n<3 or n>5000) leaves the histogram + stats intact.
//
// Residuals (item 6): a distribution-fit overlay (/api/stats/fit-distribution,
// #28) fetched lazily once a family is picked, and histogram bar brushing —
// clicking/dragging bars maps the bin range back to ORIGINAL row indices
// (rowstate's kept-index helpers) and writes the shared #50 `selection` so
// the worksheet + plot highlight the same rows. A second brush of the exact
// same bin range clears it (mirrors the worksheet grid's shift-click-range
// anchor pattern, components/Stage/worksheet/GridViewport).
//
// JMP_GAP J12 (distribution platform depth): "Compare distributions" — the
// SAME /api/stats/fit-distribution "fit all" call (dist=None) the single-fit
// overlay already makes; compareOpen just widens the trigger for that fetch
// and turns the response into a full ranked table instead of one row. The
// backend ranks by AIC; JMP ranks candidate distributions by AICc (the small-
// sample-corrected AIC), so this hook re-ranks client-side from the loglike/
// n_params/N the response already carries (`aicc = aic + 2k(k+1)/(N-k-1)`).
// fit_distribution enforces N>=5 and every curated family has n_params<=2, so
// the denominator is always >=2 in practice; the null/fallback path below is
// a defensive honesty guard, not dead code masking a real gap.
//
// JMP_GAP J7 ("By" role): an optional By column runs the SAME
// histogram/descriptive/Shapiro trio once per level of a categorical column.
// That half lives in ./useDistributionByLevels (extracted 2026-07-29,
// JMP_GAP #14 size ratchet), which also owns the per-level analysis
// primitives this file re-exports below — the un-partitioned view here is
// the n=1 case of the same computation. Kept deliberately simple (histogram
// + stats per level, JMP_GAP_PLAN's own acceptance bar) — the
// fit-distribution overlay/Compare/percentile features stay
// single-column-only; a level too small to bin still reports its N.

import { useEffect, useMemo, useState } from "react";

import { statsDescriptive } from "../../../lib/api/statsDescriptive";
import { type DistFitAllResponse, type DistFitResult, reportEmit, statsFitDistributions, statsHistogram, statsShapiro } from "../../../lib/api";
import { type DistFamily, distPdfCurve, distQuantile } from "../../../lib/distpdf";
import { rowsInBins } from "../../../lib/distribution";
import { activeRowIndices, analysisData, droppedRows } from "../../../lib/rowstate";
import type { CalcResult } from "../../../lib/types";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { toast } from "../../../store/toasts";
import type { ByColumnOption, ByLevel } from "../useByPartition";
import {
  type DistributionLevelResult,
  type HistBins,
  type Normality,
  colValues,
  normalityNote,
  numArr,
  useDistributionByLevels,
} from "./useDistributionByLevels";

// Re-exported so the panel components (HistogramStrip, DistributionLevelSection)
// and their tests keep one import site for the hook and its result shapes.
export type { DistributionLevelResult, HistBins, Normality };

export interface DistributionColumn {
  index: number;
  label: string;
}

export type FitPick = DistFamily | "none";

/** One candidate family's fit plus its AICc, when computable. */
export interface RankedFit extends DistFitResult {
  aicc: number | null;
}

/** Which statistic actually drove the Compare table's ranking. AICc is the
 *  default (matches JMP); falls back to the KS goodness-of-fit p-value —
 *  labeled honestly in the UI — only if the response can't support AICc
 *  (small-sample denominator <= 0). */
export type RankingMetric = "aicc" | "ks_p";

export interface Quantiles {
  q1: number | null;
  median: number | null;
  q3: number | null;
}

export interface DistributionState {
  hasData: boolean;
  columns: DistributionColumn[];
  col: number;
  setCol: (i: number) => void;
  label: string;
  busy: boolean;
  error: string | null;
  hist: HistBins | null;
  desc: CalcResult | null;
  norm: Normality | null;
  /** Non-null when the normality test could not run (e.g. n out of range). */
  normNote: string | null;
  // ── Distribution-fit overlay (item 6b) ─────────────────────────────────
  fitDist: FitPick;
  setFitDist: (d: FitPick) => void;
  fitBusy: boolean;
  fitError: string | null;
  fits: DistFitAllResponse | null;
  /** The currently-picked family's own fit (params/AIC/KS-p), or null while
   *  loading / if that family was skipped for this column. */
  currentFit: DistFitAllResponse["fits"][number] | null;
  /** The AIC-best family among everything fitted, regardless of the pick. */
  bestFit: DistFitAllResponse["fits"][number] | null;
  /** Reason the picked family couldn't be fit (e.g. non-positive data). */
  skippedReason: string | null;
  /** Sampled (x, pdf) curve for the picked family, or null until a fit lands. */
  fitCurve: { x: number[]; y: number[] } | null;
  // ── Compare distributions (JMP_GAP J12 items 1-2) ──────────────────────
  /** Toggles the "Compare distributions" table; also drives the fit-all
   *  fetch (independent of `fitDist`, so opening Compare alone is enough). */
  compareOpen: boolean;
  setCompareOpen: (open: boolean) => void;
  /** Every fitted family (fits.fits, `skipped` excluded) ranked by AICc
   *  ascending (ties/NaN broken by falling back to KS p descending) — index
   *  0 is the winner. Empty until a fit-all response lands. */
  rankedFits: RankedFit[];
  /** "aicc" normally; "ks_p" only if AICc couldn't be computed for every
   *  fitted family (see RankingMetric doc) — label the table honestly. */
  rankingMetric: RankingMetric;
  /** rankedFits[0].dist, or null before a fit-all response lands. */
  winnerDist: DistFamily | null;
  // ── Percentile / quantile readout (JMP_GAP J12 item 4) ─────────────────
  /** q1/median/q3 of the CURRENTLY SELECTED fit (`currentFit`, which
   *  Compare mode defaults to the AICc winner) via its closed-form inverse
   *  CDF. A family entry is `null` when that family has no closed form
   *  (gamma — documented residual in lib/distpdf.ts), not a fake value. */
  quantiles: Quantiles | null;
  /** User-entered percentile, 0-100 (default 90). */
  percentileInput: number;
  setPercentileInput: (p: number) => void;
  /** distQuantile(currentFit, percentileInput/100), or null if unavailable
   *  (no current fit, out-of-range input, or a family with no closed form). */
  percentileValue: number | null;
  // ── Histogram bar brushing (item 6c) ───────────────────────────────────
  /** The bin range [i0, i1] currently driving the shared selection, if any. */
  brushedBins: [number, number] | null;
  /** Brush bins i0..i1 (order-independent). shiftKey extends from the last
   *  anchor; brushing the exact same range again clears the selection. */
  brushBins: (i0: number, i1: number, shiftKey: boolean) => void;
  // ── "By" grouping (JMP_GAP J7) ──────────────────────────────────────────
  /** Categorical columns eligible as a By column. */
  byOptions: ByColumnOption[];
  /** null = no By column (the single un-partitioned view above is live). */
  byCol: number | null;
  setByCol: (i: number | null) => void;
  /** One ByLevel per level of `byCol`, ascending; [] when `byCol` is null. */
  byLevels: ByLevel[];
  /** Uncapped level count — > byLevels.length means the partition was
   *  truncated at BY_MAX_LEVELS and the panel must say so. */
  byTotalLevels: number;
  /** Parallel to `byLevels` once its fetches settle (histogram+stats+
   *  normality per level, the SAME trio the un-partitioned view runs). */
  byResults: DistributionLevelResult[];
  /** True while any per-level fetch in `byResults` is still in flight. */
  byBusy: boolean;
  reportBusy: boolean;
  /** Emit a #36 stats_table report: one record per By level when a By
   *  column is active, else one record for the whole current column. */
  toReport: () => Promise<void>;
}

export function useDistribution(): DistributionState {
  const active = useActiveDataset();
  const data = useMemo(() => analysisData(active), [active]);
  const setRowSelection = useApp((s) => s.setRowSelection);
  const clearRowSelection = useApp((s) => s.clearRowSelection);
  const addReport = useApp((s) => s.addReport);
  const setStatus = useApp((s) => s.setStatus);

  const columns = useMemo<DistributionColumn[]>(() => {
    if (!active) return [];
    const xName = String(active.data.metadata?.["x_column_name"] ?? "x");
    return [
      { index: -1, label: xName },
      ...active.data.labels.map((lab, i) => ({ index: i, label: lab })),
    ];
  }, [active]);

  // Default to the first channel (a value column), else x.
  const [col, setCol] = useState<number>(() => (active && active.data.labels.length ? 0 : -1));

  // JMP_GAP J7 — By-column partitioning (./useDistributionByLevels). `data`
  // is already the analysis view (guard #11), so every level is
  // post-exclusion/-filter too. The By candidate list excludes the currently
  // profiled column itself — partitioning a column by its own levels is
  // degenerate (every level would just be that one homogeneous value).
  const byColumns = useMemo(() => columns.filter((c) => c.index !== col), [columns, col]);
  const by = useDistributionByLevels(active, data, byColumns, col);
  const [reportBusy, setReportBusy] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hist, setHist] = useState<HistBins | null>(null);
  const [desc, setDesc] = useState<CalcResult | null>(null);
  const [norm, setNorm] = useState<Normality | null>(null);
  const [normNote, setNormNote] = useState<string | null>(null);

  const [fitDist, setFitDist] = useState<FitPick>("none");
  const [fitBusy, setFitBusy] = useState(false);
  const [fitError, setFitError] = useState<string | null>(null);
  const [fits, setFits] = useState<DistFitAllResponse | null>(null);

  const [compareOpen, setCompareOpen] = useState(false);
  const [percentileInput, setPercentileInput] = useState(90);

  const [brushedBins, setBrushedBins] = useState<[number, number] | null>(null);
  const [anchorBin, setAnchorBin] = useState<number | null>(null);

  // Finite values of the selected column (backend rules key off finite N).
  const finite = useMemo(() => {
    if (!data) return [];
    return colValues(data, col).filter((v) => Number.isFinite(v));
  }, [data, col]);

  useEffect(() => {
    if (!data) {
      setHist(null);
      setDesc(null);
      setNorm(null);
      return;
    }
    let cancelled = false;
    setBusy(true);
    setError(null);
    setNormNote(null);
    void Promise.allSettled([
      statsHistogram(finite),
      statsDescriptive(finite),
      statsShapiro(finite),
    ]).then(([h, d, s]) => {
      if (cancelled) return;
      setBusy(false);
      if (h.status === "fulfilled") {
        setHist({
          counts: numArr(h.value.counts),
          centers: numArr(h.value.centers),
          edges: numArr(h.value.edges),
        });
        setError(null);
      } else {
        setHist(null);
        setError("too few finite values to bin");
      }
      setDesc(d.status === "fulfilled" ? d.value : null);
      if (s.status === "fulfilled" && Number.isFinite(Number(s.value.p))) {
        setNorm({ W: Number(s.value.W), p: Number(s.value.p), N: Number(s.value.N) });
      } else {
        setNorm(null);
        setNormNote(normalityNote(finite.length));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [data, finite]);

  // Column/dataset switch → the histogram geometry changed under any live
  // brush, so drop the (now meaningless) local anchor/range tracking. The
  // shared store selection itself is left alone (another view may still want it).
  useEffect(() => {
    setBrushedBins(null);
    setAnchorBin(null);
  }, [active?.id, col]);

  // Distribution-fit overlay: lazy — only once a family is picked OR Compare
  // mode is opened, then re-fit (all curated families in one call) whenever
  // the underlying finite-value set changes. Ranked by AIC so
  // `fits.best`/`fits.fits[0]` is always the AIC-best family regardless of
  // which one is picked; the Compare table re-ranks these by AICc below.
  useEffect(() => {
    if ((fitDist === "none" && !compareOpen) || !data) {
      setFits(null);
      setFitError(null);
      setFitBusy(false);
      return;
    }
    let cancelled = false;
    setFitBusy(true);
    setFitError(null);
    statsFitDistributions(finite)
      .then((res) => {
        if (cancelled) return;
        setFits(res);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setFits(null);
        setFitError(e instanceof Error ? e.message : "distribution fit failed");
      })
      .finally(() => {
        if (!cancelled) setFitBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fitDist, compareOpen, finite, data]);

  const currentFit = useMemo(
    () => (fits && fitDist !== "none" ? (fits.fits.find((f) => f.dist === fitDist) ?? null) : null),
    [fits, fitDist],
  );
  const bestFit = fits && fits.fits.length ? fits.fits[0] : null;
  const skippedReason = useMemo(
    () => (fits && fitDist !== "none" ? (fits.skipped.find((s) => s.dist === fitDist)?.reason ?? null) : null),
    [fits, fitDist],
  );
  const fitCurve = useMemo(() => {
    if (!currentFit || !hist || fitDist === "none" || hist.edges.length < 2) return null;
    return distPdfCurve(fitDist, currentFit.params, hist.edges[0], hist.edges[hist.edges.length - 1]);
  }, [currentFit, hist, fitDist]);

  // AICc = AIC + 2k(k+1)/(N-k-1) — the small-sample-corrected AIC JMP ranks
  // distribution candidates by. `null` only when the denominator collapses
  // (N-k-1 <= 0), which fit_distribution's own N>=5 / n_params<=2 floor
  // rules out for every curated family today; kept as a real guard, not
  // dead code, in case a higher-parameter family is ever added.
  const rankedFits = useMemo<RankedFit[]>(() => {
    if (!fits) return [];
    const withAicc: RankedFit[] = fits.fits.map((f) => {
      const denom = f.N - f.n_params - 1;
      return { ...f, aicc: denom > 0 ? f.aic + (2 * f.n_params * (f.n_params + 1)) / denom : null };
    });
    const allHaveAicc = withAicc.every((f) => f.aicc != null);
    return allHaveAicc
      ? [...withAicc].sort((a, b) => (a.aicc as number) - (b.aicc as number))
      : [...withAicc].sort((a, b) => b.ks_p - a.ks_p); // fallback: honest, not AICc
  }, [fits]);

  const rankingMetric: RankingMetric =
    rankedFits.length > 0 && rankedFits.every((f) => f.aicc != null) ? "aicc" : "ks_p";

  const winnerDist = (rankedFits[0]?.dist as DistFamily | undefined) ?? null;

  // Compare mode defaults the overlay to the AICc winner the first time a
  // fit-all response lands with nothing picked yet; it never overrides a
  // family the user picked deliberately (single-fit flow unchanged).
  useEffect(() => {
    if (compareOpen && fitDist === "none" && winnerDist) setFitDist(winnerDist);
  }, [compareOpen, fitDist, winnerDist]);

  // Percentile/quantile readout (item 4) for whichever family is currently
  // selected/overlaid (defaults to the AICc winner in Compare mode). `null`
  // per-quantile entry means the family has no closed-form inverse CDF
  // (gamma) — a documented residual, not a silently-wrong number.
  const quantiles = useMemo<Quantiles | null>(() => {
    if (!currentFit) return null;
    const dist = currentFit.dist as DistFamily;
    return {
      q1: distQuantile(dist, currentFit.params, 0.25),
      median: distQuantile(dist, currentFit.params, 0.5),
      q3: distQuantile(dist, currentFit.params, 0.75),
    };
  }, [currentFit]);

  const percentileValue = useMemo(() => {
    if (!currentFit) return null;
    const p = percentileInput / 100;
    if (!(p > 0) || !(p < 1)) return null;
    return distQuantile(currentFit.dist as DistFamily, currentFit.params, p);
  }, [currentFit, percentileInput]);

  function brushBins(i0: number, i1: number, shiftKey: boolean): void {
    if (!active || !hist || !data) return;
    const useShiftExtend = shiftKey && anchorBin != null;
    const lo = useShiftExtend ? Math.min(anchorBin as number, i0, i1) : Math.min(i0, i1);
    const hi = useShiftExtend ? Math.max(anchorBin as number, i0, i1) : Math.max(i0, i1);

    if (brushedBins && brushedBins[0] === lo && brushedBins[1] === hi) {
      clearRowSelection();
      setBrushedBins(null);
      setAnchorBin(null);
      return;
    }

    const colVals = colValues(data, col); // pruned rows, unfiltered-for-finiteness
    const pruned = rowsInBins(hist.edges, colVals, lo, hi);
    const kept = activeRowIndices(active.data.time.length, droppedRows(active));
    setRowSelection(pruned.map((p) => kept[p]));
    setBrushedBins([lo, hi]);
    if (!useShiftExtend) setAnchorBin(i0);
  }

  async function toReport(): Promise<void> {
    if (!active) return;
    setReportBusy(true);
    try {
      const refs = [{ kind: "dataset", id: active.id, name: active.name }];
      const byLabel = by.byOptions.find((c) => c.index === by.byCol)?.label;
      let title: string;
      let records: Record<string, unknown>[];
      if (by.levels.length > 0) {
        title = `${label} distribution by ${byLabel ?? "level"}`;
        records = by.results.map((r) => ({
          level: r.label,
          n: r.n,
          mean: r.desc?.mean,
          median: r.desc?.median,
          std: r.desc?.std,
          min: r.desc?.min,
          max: r.desc?.max,
          shapiro_W: r.norm?.W,
          shapiro_p: r.norm?.p,
        }));
      } else {
        if (!desc) {
          setReportBusy(false);
          return;
        }
        title = `${label} distribution`;
        records = [
          {
            n: desc.N,
            mean: desc.mean,
            median: desc.median,
            std: desc.std,
            min: desc.min,
            max: desc.max,
            shapiro_W: norm?.W,
            shapiro_p: norm?.p,
          },
        ];
      }
      const { report } = await reportEmit({ kind: "stats_table", records, title, source_refs: refs });
      addReport(title, report, active.id);
      setStatus(`emitted ${title} report`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "report failed", "danger");
    } finally {
      setReportBusy(false);
    }
  }

  const label = columns.find((c) => c.index === col)?.label ?? "x";

  return {
    hasData: !!active,
    columns,
    col,
    setCol,
    label,
    busy,
    error,
    hist,
    desc,
    norm,
    normNote,
    fitDist,
    setFitDist,
    fitBusy,
    fitError,
    fits,
    currentFit,
    bestFit,
    skippedReason,
    fitCurve,
    compareOpen,
    setCompareOpen,
    rankedFits,
    rankingMetric,
    winnerDist,
    quantiles,
    percentileInput,
    setPercentileInput,
    percentileValue,
    brushedBins,
    brushBins,
    byOptions: by.byOptions,
    byCol: by.byCol,
    setByCol: by.setByCol,
    byLevels: by.levels,
    byTotalLevels: by.totalLevels,
    byResults: by.results,
    byBusy: by.busy,
    reportBusy,
    toReport,
  };
}
