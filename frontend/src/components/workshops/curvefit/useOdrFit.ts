// Curve Fit — orthogonal distance regression (ODR) state hook. Offered only
// when the active dataset has a symmetric X-error column (designated, or
// confidently paired by label — the same bindings a new figure draws with).
// Posts the plotted X / primary Y over the analysis rows (gap rows dropped),
// the X errors and, when the channel has a Y-error column, the Y errors to
// POST /api/fitting/odr (calc.fit_odr: Deming line, λ = (mean σy / mean σx)²,
// jackknife standard errors). The fitted line becomes the plot's fit overlay,
// aligned to the dataset rows exactly as useCurveFit aligns its curve.
//
// Lane WB4: the fit rides the workbench shell in manual mode (still a button;
// nothing runs on an edit). The run key is the dataset's row / data / error-role
// identity plus the plotted channels and error columns; a result whose key
// differs is out of date (`stale`), and an answer for inputs that changed while
// it was in flight is dropped. Validation failures are refusals.

import { useState } from "react";

import { dropGapRows, restoreGapRows } from "../../../lib/api/finitePairs";
import { odrFit, type OdrResult } from "../../../lib/api/fitStats";
import { fitSelectionRefusal, selectedFitData } from "../../../lib/fitselection";
import { activeRowIndices, analysisData, droppedRows, expandToFull } from "../../../lib/rowstate";
import type { Dataset } from "../../../lib/types";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { datasetInputsToken } from "../workbench/inputsKey";
import { Refusal } from "../workbench/refusal";
import { useWorkbenchPreview } from "../workbench/useWorkbenchPreview";
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
  /** The error is a refusal (the inputs cannot be fitted), not a failed request. */
  refusal: boolean;
  result: OdrResult | null;
  /** The shown result was fitted under inputs that have since changed. */
  stale: boolean;
  /** True when the fit used a Y-error column to set λ. */
  usedYErr: boolean;
  run: () => Promise<void>;
}

interface OdrRun { result: OdrResult; usedYErr: boolean }

export function useOdrFit(): OdrFitState {
  const active = useActiveDataset();
  const resolveDataset = useApp((s) => s.resolveDataset);
  const setFitOverlay = useApp((s) => s.setFitOverlay);
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const errKeys = useApp((s) => s.errKeys);
  const [refusalText, setRefusalText] = useState<string | null>(null);
  const key = active ? JSON.stringify([datasetInputsToken(active), xKey, yKeys, seriesOrder, errKeys]) : "";

  const preview = useWorkbenchPreview<OdrRun | null>({
    key,
    auto: false,
    delayMs: 0,
    fallbackError: "ODR fit failed",
    run: async (signal) => {
      if (!active) return null;
      setRefusalText(null);
      try {
        const ds = await resolveDataset(active.id);
        const d = ds ? selectedFitData(ds, xKey, yKeys, seriesOrder) : null;
        const xCh = xErrorChannel(ds);
        const refused = ds && !d ? fitSelectionRefusal(ds, xKey, yKeys, seriesOrder) : null;
        if (refused) throw new Refusal(refused);
        if (!ds || !d || xCh == null) throw new Refusal("no X-error column is designated for this dataset");
        const pairs = dropGapRows(d.x, d.y);
        const xErr = sigmas(ds, xCh, pairs.keep);
        if (!xErr) throw new Refusal("the X-error column has non-positive or invalid values");
        const yCh = errKeys[d.yKey];
        const yErr = yCh != null ? sigmas(ds, yCh, pairs.keep) : null;
        const r = await odrFit({ x: pairs.x, y: pairs.y, x_error: xErr, ...(yErr ? { y_error: yErr } : {}) }, signal);
        // The inputs changed (or the panel closed) while the request ran: its answer is not theirs.
        if (signal.aborted) return null;
        const n = ds.data.time.length;
        const kept = activeRowIndices(n, droppedRows(ds));
        const aligned = restoreGapRows(pairs.x.map((x) => r.slope * x + r.intercept), pairs);
        setFitOverlay({ datasetId: ds.id, binding: { yKey: d.yKey, xKey: d.xKey }, y: kept.length === n ? aligned : expandToFull(aligned, kept, n), curveFit: true });
        return { result: r, usedYErr: yErr != null };
      } catch (e) {
        if (e instanceof Refusal) setRefusalText(e.message);
        throw e;
      }
    },
  });

  const error = preview.error || null;
  // A failed run shows its error and no result, as before.
  const latest = error ? null : preview.latest?.value ?? null;
  return {
    busy: preview.running,
    error,
    refusal: error !== null && error === refusalText,
    result: latest?.result ?? null,
    stale: latest !== null && preview.stale,
    usedYErr: latest?.usedYErr ?? false,
    run: preview.refresh,
  };
}
