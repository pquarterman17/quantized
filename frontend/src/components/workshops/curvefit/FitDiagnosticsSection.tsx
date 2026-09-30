// Curve Fit — Diagnostics panel (lazy chunk). Collapsed by default; opening
// it posts the current fit's y and residuals to /api/fitting/diagnostics
// (calc.fit_stats.fit_compare + residual_diagnostics) and lists the goodness-
// of-fit and residual statistics. Reduced χ² is the fit's own (curve_fit).

import { useEffect, useState } from "react";

import { DataTable } from "../../primitives/DataTable";
import { fitDiagnostics, type DiagnosticsResult } from "../../../lib/api/fitStats";
import { fmtNum as fmt } from "../../../lib/format";
import type { CalcResult } from "../../../lib/types";

interface Props {
  result: CalcResult;
  fitData: { x: number[]; y: number[] };
}

function rowsFor(d: DiagnosticsResult, result: CalcResult): string[][] {
  const c = d.compare;
  const r = d.residuals;
  const runs = r.runsTestZ == null ? "—" : `${fmt(r.runsTestZ)} (p ${fmt(r.runsTestP)})`;
  return [
    ["n / k", `${c.n} / ${c.p}`],
    ["R²", fmt(c.R2)],
    ["adj. R²", fmt(c.adjR2)],
    ["reduced χ²", fmt(result.chiSqRed)],
    ["RMSE", fmt(c.rmse)],
    ["AIC", fmt(c.aic)],
    ["AICc", fmt(c.aicc)],
    ["BIC", fmt(c.bic)],
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
            AIC, AICc and BIC here use n·ln(RSS/n), so they differ from the fit&apos;s AIC by a constant.
          </div>
        </div>
      )}
    </details>
  );
}
