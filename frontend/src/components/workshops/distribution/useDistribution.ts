// Distribution platform (ORIGIN_GAP #52) — state hook. For one column of the
// active dataset it composes three already-golden backends: a histogram
// (/api/statplots/histogram), descriptive stats (/api/stats/descriptive), and a
// Shapiro-Wilk normality test (/api/stats/shapiro). Reads the dataset's ANALYSIS
// view (rowstate.analysisData) so excluded rows (#50) drop from the distribution.
// The three calls are settled independently: a Shapiro n-range failure (n<3 or
// n>5000) leaves the histogram + stats intact.

import { useEffect, useMemo, useState } from "react";

import { statsDescriptive, statsHistogram, statsShapiro } from "../../../lib/api";
import { analysisData } from "../../../lib/rowstate";
import type { CalcResult, DataStruct } from "../../../lib/types";
import { useActiveDataset } from "../../../store/useApp";

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
}

const colValues = (data: DataStruct, index: number): number[] =>
  index < 0 ? data.time : data.values.map((row) => row[index]);

const numArr = (v: unknown): number[] =>
  Array.isArray(v) ? v.map((x) => Number(x)) : [];

export function useDistribution(): DistributionState {
  const active = useActiveDataset();
  const data = useMemo(() => analysisData(active), [active]);

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
  };
}
