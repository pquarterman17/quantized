// Curve Fit — one collapsible section per level of the chosen By column
// (JMP_GAP_PLAN J7 residual). Mirrors FitYByXLevelSection's collapsible-
// section convention. A level with too few/invalid points shows an honest
// "not enough data" line (set by useCurveFitByLevel's try/catch) instead of
// a crash.

import { useState } from "react";

import { fmtNum as fmt } from "../../../lib/format";
import { DataTable } from "../../primitives";
import type { CurveFitLevelResult } from "./useCurveFitByLevel";

export default function CurveFitByLevelSection({
  result,
  paramNames,
}: {
  result: CurveFitLevelResult;
  paramNames: string[];
}) {
  const [open, setOpen] = useState(true);
  const params = (result.result?.params as number[] | undefined) ?? [];
  const errors = (result.result?.errors as (number | null)[] | undefined) ?? [];
  const paramRows = params.map((p, i) => [paramNames[i] ?? `p${i}`, fmt(p), fmt(errors[i])]);

  return (
    <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 6,
          color: "var(--text)",
          font: "inherit",
        }}
      >
        <span aria-hidden>{open ? "▾" : "▸"}</span>
        <strong>{result.label}</strong>
        <span className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          n={result.n}
        </span>
      </button>

      {open &&
        (result.error ? (
          <div className="qzk-ds-meta" style={{ marginTop: 6, color: "var(--text-faint)" }}>
            {result.error}
          </div>
        ) : (
          paramRows.length > 0 && (
            <div style={{ marginTop: 6, overflowX: "auto" }}>
              <DataTable columns={["param", "value", "± err"]} rows={paramRows} />
              {result.result && (
                <div className="qzk-ds-meta" style={{ marginTop: 4, color: "var(--text-faint)" }}>
                  R² {fmt(result.result.R2)} · RMSE {fmt(result.result.RMSE)}
                </div>
              )}
            </div>
          )
        ))}
    </div>
  );
}
