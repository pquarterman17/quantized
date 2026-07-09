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

import { useEffect, useMemo, useState } from "react";

import {
  type DistFitAllResponse,
  statsDescriptive,
  statsFitDistributions,
  statsHistogram,
  statsShapiro,
} from "../../../lib/api";
import { type DistFamily, distPdfCurve } from "../../../lib/distpdf";
import { rowsInBins } from "../../../lib/distribution";
import { activeRowIndices, analysisData, droppedRows } from "../../../lib/rowstate";
import type { CalcResult, DataStruct } from "../../../lib/types";
import { useActiveDataset, useApp } from "../../../store/useApp";

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
export interface DistributionColumn {
  index: number;
  label: string;
}

export type FitPick = DistFamily | "none";

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
  // ── Histogram bar brushing (item 6c) ───────────────────────────────────
  /** The bin range [i0, i1] currently driving the shared selection, if any. */
  brushedBins: [number, number] | null;
  /** Brush bins i0..i1 (order-independent). shiftKey extends from the last
   *  anchor; brushing the exact same range again clears the selection. */
  brushBins: (i0: number, i1: number, shiftKey: boolean) => void;
}

const colValues = (data: DataStruct, index: number): number[] =>
  index < 0 ? data.time : data.values.map((row) => row[index]);

const numArr = (v: unknown): number[] =>
  Array.isArray(v) ? v.map((x) => Number(x)) : [];

export function useDistribution(): DistributionState {
  const active = useActiveDataset();
  const data = useMemo(() => analysisData(active), [active]);
  const setRowSelection = useApp((s) => s.setRowSelection);
  const clearRowSelection = useApp((s) => s.clearRowSelection);

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
    Promise.allSettled([
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
        setNormNote(
          finite.length < 3
            ? "need ≥ 3 values"
            : finite.length > 5000
              ? "n > 5000 (Shapiro limit)"
              : "normality test unavailable",
        );
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

  // Distribution-fit overlay: lazy — only once a family is picked, then
  // re-fit (all curated families in one call) whenever the underlying
  // finite-value set changes. Ranked by AIC so `fits.best`/`fits.fits[0]`
  // is always the AIC-best family regardless of which one is picked.
  useEffect(() => {
    if (fitDist === "none" || !data) {
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
  }, [fitDist, finite, data]);

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
    brushedBins,
    brushBins,
  };
}
