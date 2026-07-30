// Multivariate workbench (JMP_GAP J10) — state hook. Composes two already-
// golden backends against the SAME listwise-complete row set: pairwise
// correlation (/api/stats/correlation, pearson/spearman + p-values) and PCA
// (/api/stats/pca, SVD-based). Reads the dataset's ANALYSIS view
// (rowstate.analysisData) so excluded rows (#50) and the local filter (#53)
// drop from every column — the guarded row-state chokepoint (#11).
//
// Listwise deletion is done ONCE, client-side (lib/multivar.listwiseComplete),
// across every SELECTED column, and the resulting row-major matrix feeds
// correlation (transposed to column-major), PCA (which raises on any NaN/Inf,
// unlike correlation's own internal dropping), AND the SPLOM scatter — so
// all three views agree on exactly the same N and the same rows.
//
// Residual (item 6, booked in JMP_GAP_PLAN #10): matplotlib export parity
// (a `figure_multivar` renderer) is explicitly NOT attempted in this pass.

import { useEffect, useMemo, useState } from "react";

import {
  type CorrelationResponse,
  type PCAResponse,
  statsCorrelation,
  statsPCA,
} from "../../../lib/api";
import {
  correlationToTSV,
  defaultContinuousColumns,
  listwiseComplete,
  multivarColumns,
  multivarColumnValues,
  transposeRows,
  type MultivarColumn,
} from "../../../lib/multivar";
import { analysisData } from "../../../lib/rowstate";
import { useActiveDataset } from "../../../store/useApp";

export type CorrMethod = "pearson" | "spearman";

export interface MultivarState {
  hasData: boolean;
  columns: MultivarColumn[];
  selected: number[];
  toggleColumn: (index: number) => void;
  selectAll: () => void;
  selectDefault: () => void;
  /** Labels of the selected columns, in the SAME order as `rows`' columns. */
  labels: string[];
  /** Listwise-complete row-major matrix over the selected columns (shared by
   *  correlation, PCA, and the SPLOM scatter). */
  rows: number[][];
  tooFewColumns: boolean;

  method: CorrMethod;
  setMethod: (m: CorrMethod) => void;
  corr: CorrelationResponse | null;
  corrBusy: boolean;
  corrError: string | null;
  toTSV: () => string;

  standardize: boolean;
  setStandardize: (b: boolean) => void;
  pca: PCAResponse | null;
  pcaBusy: boolean;
  pcaError: string | null;
  pcX: number;
  pcY: number;
  setPcX: (i: number) => void;
  setPcY: (i: number) => void;
}

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

export function useMultivar(): MultivarState {
  const active = useActiveDataset();
  const data = useMemo(() => analysisData(active), [active]);

  const columns = useMemo<MultivarColumn[]>(() => multivarColumns(active), [active]);

  const [selected, setSelected] = useState<number[]>(() => defaultContinuousColumns(active));
  // Reset the selection when the ACTIVE DATASET changes (a new dataset's
  // channel set is unrelated to the old one's) — but not on every data edit,
  // so a mid-session correction doesn't silently drop the user's picks.
  useEffect(() => {
    setSelected(defaultContinuousColumns(active));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  function toggleColumn(index: number): void {
    setSelected((cur) => (cur.includes(index) ? cur.filter((c) => c !== index) : [...cur, index].sort((a, b) => a - b)));
  }
  function selectAll(): void {
    setSelected(columns.map((c) => c.index));
  }
  function selectDefault(): void {
    setSelected(defaultContinuousColumns(active));
  }

  const labels = useMemo(
    () => selected.map((i) => columns.find((c) => c.index === i)?.label ?? (i < 0 ? "x" : `col ${i}`)),
    [selected, columns],
  );

  const rows = useMemo(() => {
    if (!data || selected.length < 2) return [];
    const cols = selected.map((i) => multivarColumnValues(data, i));
    return listwiseComplete(cols);
  }, [data, selected]);

  const tooFewColumns = selected.length < 2;

  // ── Correlation ────────────────────────────────────────────────────────
  const [method, setMethod] = useState<CorrMethod>("pearson");
  const [corr, setCorr] = useState<CorrelationResponse | null>(null);
  const [corrBusy, setCorrBusy] = useState(false);
  const [corrError, setCorrError] = useState<string | null>(null);

  useEffect(() => {
    if (tooFewColumns || rows.length < 3) {
      setCorr(null);
      setCorrError(tooFewColumns ? "select at least 2 columns" : "need at least 3 complete rows");
      setCorrBusy(false);
      return;
    }
    let cancelled = false;
    setCorrBusy(true);
    setCorrError(null);
    statsCorrelation(transposeRows(rows), method)
      .then((res) => {
        if (cancelled) return;
        setCorr(res);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setCorr(null);
        setCorrError(errMsg(e, "correlation failed"));
      })
      .finally(() => {
        if (!cancelled) setCorrBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rows, method, tooFewColumns]);

  function toTSV(): string {
    if (!corr) return "";
    return correlationToTSV(labels, corr.r);
  }

  // ── PCA ────────────────────────────────────────────────────────────────
  const [standardize, setStandardize] = useState(false);
  const [pca, setPca] = useState<PCAResponse | null>(null);
  const [pcaBusy, setPcaBusy] = useState(false);
  const [pcaError, setPcaError] = useState<string | null>(null);
  const [pcX, setPcX] = useState(0);
  const [pcY, setPcY] = useState(1);

  useEffect(() => {
    if (tooFewColumns || rows.length < 2) {
      setPca(null);
      setPcaError(tooFewColumns ? "select at least 2 columns" : "need at least 2 complete rows");
      setPcaBusy(false);
      return;
    }
    let cancelled = false;
    setPcaBusy(true);
    setPcaError(null);
    statsPCA({ data: rows, center: true, scale: standardize })
      .then((res) => {
        if (cancelled) return;
        setPca(res);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setPca(null);
        setPcaError(errMsg(e, "PCA failed"));
      })
      .finally(() => {
        if (!cancelled) setPcaBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rows, standardize, tooFewColumns]);

  // Keep the scores-scatter PC picks in range as the component count changes.
  useEffect(() => {
    const k = pca?.explained.length ?? 0;
    if (k === 0) return;
    if (pcX >= k) setPcX(0);
    if (pcY >= k) setPcY(Math.min(1, k - 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pca]);

  return {
    hasData: !!active,
    columns,
    selected,
    toggleColumn,
    selectAll,
    selectDefault,
    labels,
    rows,
    tooFewColumns,
    method,
    setMethod,
    corr,
    corrBusy,
    corrError,
    toTSV,
    standardize,
    setStandardize,
    pca,
    pcaBusy,
    pcaError,
    pcX,
    pcY,
    setPcX,
    setPcY,
  };
}
