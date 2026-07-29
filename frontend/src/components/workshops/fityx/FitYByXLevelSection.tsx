// Fit Y by X — one collapsible section per level of the chosen By column
// (JMP_GAP_PLAN J7). Reuses the SAME per-leg views (Oneway/Bivariate/
// Contingency) the un-partitioned workbench uses — one dispatch, rendered
// once per level. A level with too few rows for this leg shows an honest
// "not enough data" line (set by useFitYByX's runLeg error handling)
// instead of a crash.

import { useState } from "react";

import type { FitYByXKind, FitYByXLevelResult } from "./useFitYByX";
import BivariateView from "./BivariateView";
import ContingencyView from "./ContingencyView";
import OnewayView from "./OnewayView";

export default function FitYByXLevelSection({
  result,
  kind,
}: {
  result: FitYByXLevelResult;
  kind: FitYByXKind;
}) {
  const [open, setOpen] = useState(true);

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
          <>
            {kind === "oneway" && result.oneway && <OnewayView result={result.oneway} />}
            {kind === "bivariate" && result.bivariate && <BivariateView result={result.bivariate} />}
            {kind === "contingency" && result.contingency && <ContingencyView result={result.contingency} />}
          </>
        ))}
    </div>
  );
}
