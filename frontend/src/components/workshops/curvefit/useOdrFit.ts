// Curve Fit — orthogonal distance regression (ODR) state hook. Offered only
// when the active dataset has a symmetric X-error column (designated, or
// confidently paired by label — the same bindings a new figure draws with).
// Posts the plotted X / primary Y over the analysis rows (gap rows dropped),
// the X errors and, when the channel has a Y-error column, the Y errors to
// POST /api/fitting/odr (calc.fit_odr: Deming line, λ = (mean σy / mean σx)²,
// jackknife standard errors). The fitted line becomes the plot's fit overlay,
// aligned to the dataset rows exactly as useCurveFit aligns its curve.

import { useState } from "react";

import { dropGapRows, restoreGapRows } from "../../../lib/api/finitePairs";
import { odrFit, type OdrResult } from "../../../lib/api/fitStats";
import { selectedFitData } from "../../../lib/fitselection";
import { activeRowIndices, analysisData, droppedRows, expandToFull } from "../../../lib/rowstate";
import type { Dataset } from "../../../lib/types";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { xErrorChannel } from "./xErrorChannel";

/** |column| over the analysis rows, kept rows only; null if any is not a
 *  positive finite number. */
function sigmas(ds: Dataset, channel: number, keep: readonly number[]): number[] | null {
  const data = analysisData(ds);
  if (!data) return null;
  const out = keep.map((i) => Math.abs(data.values[i]?.[channel] ?? Number.NaN));
  return out.every((v) => Number.isFinite(v) && v > 0) ? out : null;
}

export interface OdrFitState {
  busy: boolean;
  error: string | null;
  result: OdrResult | null;
  /** True when the fit used a Y-error column to set λ. */
  usedYErr: boolean;
  run: () => Promise<void>;
}

export function useOdrFit(): OdrFitState {
  const active = useActiveDataset();
  const resolveDataset = useApp((s) => s.resolveDataset);
  const setFitOverlay = useApp((s) => s.setFitOverlay);
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const errKeys = useApp((s) => s.errKeys);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OdrResult | null>(null);
  const [usedYErr, setUsedYErr] = useState(false);

  async function run(): Promise<void> {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      const ds = await resolveDataset(active.id);
      const d = ds ? selectedFitData(ds, xKey, yKeys, seriesOrder) : null;
      const xCh = xErrorChannel(ds);
      if (!ds || !d || xCh == null) throw new Error("no X-error column is designated for this dataset");
      const pairs = dropGapRows(d.x, d.y);
      const xErr = sigmas(ds, xCh, pairs.keep);
      if (!xErr) throw new Error("the X-error column has non-positive or invalid values");
      const yCh = errKeys[d.yKey];
      const yErr = yCh != null ? sigmas(ds, yCh, pairs.keep) : null;
      const r = await odrFit({ x: pairs.x, y: pairs.y, x_error: xErr, ...(yErr ? { y_error: yErr } : {}) });
      setResult(r);
      setUsedYErr(yErr != null);
      const n = ds.data.time.length;
      const kept = activeRowIndices(n, droppedRows(ds));
      const aligned = restoreGapRows(pairs.x.map((x) => r.slope * x + r.intercept), pairs);
      setFitOverlay({ datasetId: ds.id, y: kept.length === n ? aligned : expandToFull(aligned, kept, n) });
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "ODR fit failed");
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, result, usedYErr, run };
}
