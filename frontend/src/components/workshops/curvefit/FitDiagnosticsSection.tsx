// Curve Fit — Diagnostics panel (lazy chunk). Collapsed by default; opening
// it posts the current fit's y and residuals to /api/fitting/diagnostics
// (calc.fit_stats.fit_compare + residual_diagnostics) and lists the goodness-
// of-fit and residual statistics. Reduced χ², RMSE and AIC/AICc/BIC are the
// fit's OWN numbers (curve_fit, calc.fit_metrics) whenever the result carries
// them, so this panel and the fit summary can never disagree (fitting audit
// finding 16 -- they used to differ by a constant, and by weighting); the
// route's values are the fallback for an older result. RMSE is unweighted, in
// y units; a weighted fit also lists its weighted χ² (the minimised sum).

import { useEffect, useState } from "react";

import { DataTable } from "../../primitives/DataTable";
import { fitDiagnostics, type DiagnosticsResult } from "../../../lib/api/fitStats";
import { fmtNum as fmt } from "../../../lib/format";
import type { CalcResult } from "../../../lib/types";

interface Props {
  result: CalcResult;
  fitData: { x: number[]; y: number[] };
}

/** The fit's own metric when it has one, else the diagnostics route's. */
function own(result: CalcResult, key: string, fallback: number | null): number | null {
  const v = result[key];
  return typeof v === "number" ? v : fallback;
}

function rowsFor(d: DiagnosticsResult, result: CalcResult): string[][] {
  const c = d.compare;
  const r = d.residuals;
  const runs = r.runsTestZ == null ? "—" : `${fmt(r.runsTestZ)} (p ${fmt(r.runsTestP)})`;
  const weighted = typeof result.chiSq === "number" && typeof result.SSR === "number" && result.chiSq !== result.SSR;
  return [
    ["n / k", `${c.n} / ${c.p}`],
    ["R²", fmt(c.R2)],
    ["adj. R²", fmt(c.adjR2)],
    ["reduced χ²", fmt(result.chiSqRed)],
    ...(weighted ? [["weighted χ²", fmt(result.chiSq)]] : []),
    ["RMSE (y units)", fmt(own(result, "RMSE", c.rmse))],
    ["AIC", fmt(own(result, "AIC", c.aic))],
    ["AICc", fmt(own(result, "AICc", c.aicc))],
    ["BIC", fmt(own(result, "BIC", c.bic))],
    ["Durbin–Watson", fmt(r.durbinWatson)],
    ["runs test z", runs],
    ["skewness", fmt(r.skewness)],
    ["excess kurtosis", fmt(r.kurtosis)],
  ];
}

export default function FitDiagnosticsSection({ result, fitData }: Props) {
  const [open, setOpen] = useState(false);
  const [diag, setDiag] = useState<DiagnosticsResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDiag(null);
    setError(null);
    const residuals = result.residuals as (number | null)[] | undefined;
    if (!open || !Array.isArray(residuals)) return;
    const ctrl = new AbortController();
    const nParams = Number(result.nFree ?? (result.params as number[] | undefined)?.length ?? 0);
    fitDiagnostics(
      { y: fitData.y, residuals: residuals.map((v) => v ?? Number.NaN), n_params: nParams },
      ctrl.signal,
    )
      .then(setDiag)
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : "diagnostics failed");
      });
    return () => ctrl.abort();
  }, [open, result, fitData]);

  return (
    <details
      style={{ marginTop: 10 }}
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="qzk-field-lbl">Diagnostics</summary>
      {error && (
        <div className="qzk-ds-meta" style={{ marginTop: 6, color: "var(--danger)" }}>
          {error}
        </div>
      )}
      {open && !diag && !error && (
        <div className="qzk-ds-meta" style={{ marginTop: 6, color: "var(--text-faint)" }}>
          computing diagnostics…
        </div>
      )}
      {diag && (
        <div style={{ marginTop: 6 }}>
          <DataTable columns={["diagnostic", "value"]} rows={rowsFor(diag, result)} />
          <div className="qzk-ds-meta" style={{ marginTop: 4, color: "var(--text-faint)" }}>
            AIC = 2k − 2 ln L (Gaussian likelihood on the fit&apos;s weighted χ²), the same value the fit reports.
          </div>
        </div>
      )}
    </details>
  );
}
