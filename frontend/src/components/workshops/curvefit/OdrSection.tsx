// Curve Fit — ODR section (lazy chunk). CurveFitPanel mounts it only when the
// active dataset has an X-error column: a straight-line fit that minimises
// perpendicular distances, for data with errors in x AND y (useOdrFit).

import { Button, Select } from "../../primitives";
import { DataTable } from "../../primitives/DataTable";
import { fmtNum as fmt } from "../../../lib/format";
import { OutOfDateNote, WorkbenchMessage } from "../workbench/WorkbenchParts";
import { useOdrFit, type OdrWeighting } from "./useOdrFit";

export default function OdrSection() {
  const { busy, error, refusal, result, york, stale, usedYErr, weighting, setWeighting, yorkBlocked, run } = useOdrFit();
  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border-soft)" }}>
      <label className="qzk-field-lbl">Errors in x and y</label>
      <Select
        aria-label="Weighting"
        options={[
          { value: "deming", label: "Weighting: variance ratio (Deming)" },
          { value: "york", label: "Weighting: per-point errors (York)" },
        ]}
        value={weighting}
        disabled={busy || yorkBlocked !== null}
        onChange={(e) => setWeighting(e.target.value as OdrWeighting)}
      />
      {yorkBlocked && <div className="qzk-ds-meta" style={{ margin: "4px 0", color: "var(--text-faint)" }}>{yorkBlocked}</div>}
      <Button
        size="sm"
        disabled={busy}
        title={weighting === "york"
          ? "Fit a straight line with York's method, using each point's own X and Y error"
          : "Fit a straight line by orthogonal distance regression, using the X-error column"}
        onClick={() => void run()}
      >
        {busy ? "Fitting…" : weighting === "york" ? "Fit line (York)" : "Fit line (ODR)"}
      </Button>
      <WorkbenchMessage refusal={refusal ? error : null} error={refusal ? null : error} />
      {york && !busy && (
        <div style={{ marginTop: 8 }}>
          {stale && <OutOfDateNote block>the data, channels or error columns changed after this fit. Fit again.</OutOfDateNote>}
          <DataTable
            columns={["param", "value", "± err", "± err × √MSWD"]}
            rows={[
              ["slope", fmt(york.slope), fmt(york.slopeErr), fmt(york.slopeErrScaled)],
              ["intercept", fmt(york.intercept), fmt(york.interceptErr), fmt(york.interceptErrScaled)],
            ]}
          />
          <DataTable
            columns={["stat", "value"]}
            rows={[
              ["χ²", fmt(york.chiSq)],
              ["reduced χ² (MSWD)", fmt(york.mswd)],
              ["degrees of freedom", String(york.dof)],
              ["n", String(york.n)],
            ]}
          />
          <div className="qzk-ds-meta" style={{ marginTop: 4, color: "var(--text-faint)" }}>
            York et al. (2004): every point is weighted by its own X and Y error. MSWD near 1 means the errors explain the scatter.
          </div>
        </div>
      )}
      {result && !busy && (
        <div style={{ marginTop: 8 }}>
          {stale && <OutOfDateNote block>the data, channels or error columns changed after this fit. Fit again.</OutOfDateNote>}
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
