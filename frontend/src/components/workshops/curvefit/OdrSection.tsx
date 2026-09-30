// Curve Fit — ODR section (lazy chunk). CurveFitPanel mounts it only when the
// active dataset has an X-error column: a straight-line fit that minimises
// perpendicular distances, for data with errors in x AND y (useOdrFit).

import { Button } from "../../primitives";
import { DataTable } from "../../primitives/DataTable";
import { fmtNum as fmt } from "../../../lib/format";
import { useOdrFit } from "./useOdrFit";

export default function OdrSection() {
  const { busy, error, result, usedYErr, run } = useOdrFit();
  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border-soft)" }}>
      <label className="qzk-field-lbl">Errors in x and y</label>
      <Button
        size="sm"
        disabled={busy}
        title="Fit a straight line by orthogonal distance regression, using the X-error column"
        onClick={() => void run()}
      >
        {busy ? "Fitting…" : "Fit line (ODR)"}
      </Button>
      {error && (
        <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--danger)" }}>
          {error}
        </div>
      )}
      {result && !busy && (
        <div style={{ marginTop: 8 }}>
          <DataTable
            columns={["param", "value", "± err"]}
            rows={[
              ["slope", fmt(result.slope), fmt(result.slopeErr)],
              ["intercept", fmt(result.intercept), fmt(result.interceptErr)],
            ]}
          />
          <DataTable
            columns={["stat", "value"]}
            rows={[
              ["λ = σy²/σx²", fmt(result.lambda)],
              ["RMSE (orthogonal)", fmt(result.rmse)],
              ["n", String(result.n)],
            ]}
          />
          <div className="qzk-ds-meta" style={{ marginTop: 4, color: "var(--text-faint)" }}>
            {usedYErr
              ? "λ comes from the X- and Y-error columns; errors are jackknife estimates."
              : "No Y-error column, so x and y errors are taken as equal (λ = 1)."}
          </div>
        </div>
      )}
    </div>
  );
}
