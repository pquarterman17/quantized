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

import { useEffect, useMemo, useRef, useState } from "react";

import { dropGapRows, restoreGapRows } from "../../../lib/api/finitePairs";
import { odrFit, yorkFit, type OdrResult, type YorkResult } from "../../../lib/api/fitStats";
import { fitSelectionRefusal, selectedFitData } from "../../../lib/fitselection";
import { activeRowIndices, analysisData, droppedRows, expandToFull } from "../../../lib/rowstate";
import type { Dataset, FitOverlay } from "../../../lib/types";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { datasetInputsToken } from "../workbench/inputsKey";
import { afterCommit } from "../workbench/afterCommit";
import { Refusal } from "../workbench/refusal";
import { useWorkbenchPreview } from "../workbench/useWorkbenchPreview";
import { takeBackOverlay } from "./fitOverlayOwnership";
import { xErrorChannel } from "./xErrorChannel";

/** |column| over the analysis rows, kept rows only; null if any is not a
 *  positive finite number. */
function sigmas(ds: Dataset, channel: number, keep: readonly number[]): number[] | null {
  const data = analysisData(ds);
  if (!data) return null;
  const out = keep.map((i) => Math.abs(data.values[i]?.[channel] ?? Number.NaN));
  return out.every((v) => Number.isFinite(v) && v > 0) ? out : null;
}

/** "deming": one variance ratio from the mean errors (calc.fit_odr). "york":
 *  each point's own X and Y error (calc.fit_york). */
export type OdrWeighting = "deming" | "york";

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
  /** The weighting in effect: York only while it is available. */
  weighting: OdrWeighting;
  setWeighting: (w: OdrWeighting) => void;
  /** Why York cannot be chosen now (it needs an X-error and a Y-error column), else null. */
  yorkBlocked: string | null;
  /** The York result, when the shown fit used per-point weighting (`result` is then null). */
  york: YorkResult | null;
  run: () => Promise<void>;
}

interface OdrRun { result: OdrResult | null; york: YorkResult | null; usedYErr: boolean }

export function useOdrFit(): OdrFitState {
  const active = useActiveDataset();
  const resolveDataset = useApp((s) => s.resolveDataset);
  const setFitOverlay = useApp((s) => s.setFitOverlay);
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const errKeys = useApp((s) => s.errKeys);
  const ownOverlay = useRef<FitOverlay | null>(null);
  const [chosen, setWeighting] = useState<OdrWeighting>("deming");
  // York needs a Y-error column on the plotted Y as well as the X-error one.
  const plotted = useMemo(() => (active ? selectedFitData(active, xKey, yKeys, seriesOrder) : null), [active, xKey, yKeys, seriesOrder]);
  const yorkBlocked = plotted && errKeys[plotted.yKey] != null
    ? null : "York needs a Y-error column on the plotted Y as well as an X-error column.";
  const weighting: OdrWeighting = yorkBlocked ? "deming" : chosen;
  const key = active ? JSON.stringify([datasetInputsToken(active), xKey, yKeys, seriesOrder, errKeys, weighting]) : "";

  const preview = useWorkbenchPreview<OdrRun | null>({
    key,
    auto: false,
    delayMs: 0,
    fallbackError: "ODR fit failed",
    run: async (signal) => {
      if (!active) return null;
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
      if (weighting === "york" && !yErr) throw new Refusal("the Y-error column has non-positive or invalid values");
      const r = weighting === "york" && yErr
        ? await yorkFit({ x: pairs.x, y: pairs.y, x_error: xErr, y_error: yErr }, signal)
        : await odrFit({ x: pairs.x, y: pairs.y, x_error: xErr, ...(yErr ? { y_error: yErr } : {}) }, signal);
      // The inputs changed (or the panel closed) while the request ran: its answer is not theirs.
      if (signal.aborted) return null;
      const n = ds.data.time.length;
      const kept = activeRowIndices(n, droppedRows(ds));
      const aligned = restoreGapRows(pairs.x.map((x) => r.slope * x + r.intercept), pairs);
      const overlay: FitOverlay = { datasetId: ds.id, binding: { yKey: d.yKey, xKey: d.xKey }, y: kept.length === n ? aligned : expandToFull(aligned, kept, n), curveFit: true };
      ownOverlay.current = overlay;
      setFitOverlay(overlay);
      return weighting === "york" ? { result: null, york: r as YorkResult, usedYErr: true } : { result: r as OdrResult, york: null, usedYErr: yErr != null };
    },
  });

  const error = preview.error || null;
  // An out-of-date fit's line is taken off the plot (only if it is still ours).
  const outOfDate = preview.stale;
  useEffect(() => {
    if (outOfDate) takeBackOverlay(ownOverlay.current);
  }, [outOfDate]);
  // A failed run shows its error and no result, as before.
  const latest = error ? null : preview.latest?.value ?? null;
  return {
    busy: preview.running,
    error,
    refusal: error !== null && preview.refusal,
    result: latest?.result ?? null,
    stale: latest !== null && preview.stale,
    usedYErr: latest?.usedYErr ?? false,
    weighting,
    setWeighting,
    yorkBlocked,
    york: latest?.york ?? null,
    run: async () => {
      // Resolve a lazy book first: its arrival moves the key, which would abort a run launched before it.
      if (active?.pending) {
        await resolveDataset(active.id);
        await afterCommit();
      }
      return preview.refresh();
    },
  };
}
