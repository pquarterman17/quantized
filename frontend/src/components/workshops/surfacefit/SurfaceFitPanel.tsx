// Surface fit z = f(x, y) — view. Pick X / Y / Z columns, a model and starting
// values, fit, then read the parameter table (value, SE, confidence limits),
// the headline statistics and a residual map; "Add fitted surface" writes the
// model surface and residuals as a new dataset. Logic lives in useSurfaceFit.

import ToolWindow from "../../overlays/ToolWindow";
import ReopenBanner from "../resultcommit/ReopenBanner";
import { useReopenScope } from "../resultcommit/useReopenSession";
import { Button, Select } from "../../primitives";
import { DataTable } from "../../primitives/DataTable";
import { NumberField } from "../../primitives/NumberField";
import { colormapCss } from "../../../lib/colormap";
import { fmtNum as fmt } from "../../../lib/format";
import { useAnalysisExtras } from "../../../store/analysisExtras";
import { pickOptions } from "../analysisextras/columnPicks";
import ToolInputSummary from "../analysisselection/ToolInputSummary";
import SurfaceFitBatchSection from "./SurfaceFitBatchSection";
import SurfaceFitByLevel from "./SurfaceFitByLevel";
import SurfaceResidualMap, { residualScale } from "./SurfaceResidualMap";
import { useSurfaceFit } from "./useSurfaceFit";

const RAMP = `linear-gradient(to right, ${[0, 0.25, 0.5, 0.75, 1].map((t) => colormapCss("rdbu", t)).join(", ")})`;

function SurfaceFitPanelBody() {
  const hide = useAnalysisExtras((s) => s.hide);
  const f = useSurfaceFit();
  const opts = pickOptions(f.columns);
  const r = f.result;
  const pct = r ? `${Math.round(r.level * 100)}%` : "95%";

  return (
    <ToolWindow id="surface-fit" title="Surface fit z = f(x, y)" width={480} onClose={() => hide("surface-fit")}>
      <ReopenBanner tool="surface-fit" />
      {!f.hasData ? (
        <div className="qzk-helptext">
          Select a dataset with at least three columns: the X axis plus two channels, such as a map or a long-form
          X, Y, Z table.
        </div>
      ) : (
        <>
          <ToolInputSummary xKey={f.xCol} columns={[f.yCol, f.zCol]} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 8 }}>
            <div>
              <label className="qzk-field-lbl">X</label>
              <Select aria-label="X column" options={opts} value={String(f.xCol)} onChange={(e) => f.setXCol(Number(e.target.value))} />
            </div>
            <div>
              <label className="qzk-field-lbl">Y</label>
              <Select aria-label="Y column" options={opts} value={String(f.yCol)} onChange={(e) => f.setYCol(Number(e.target.value))} />
            </div>
            <div>
              <label className="qzk-field-lbl">Z (fitted)</label>
              <Select aria-label="Z column" options={opts} value={String(f.zCol)} onChange={(e) => f.setZCol(Number(e.target.value))} />
            </div>
          </div>

          <div style={{ marginTop: 10 }}>
            <label className="qzk-field-lbl">Model</label>
            <Select
              aria-label="Model"
              options={f.models.map((m) => ({ value: m.name, label: m.name }))}
              value={f.model?.name ?? ""}
              onChange={(e) => f.setModelName(e.target.value)}
            />
            {f.model && <div className="qzk-helptext" style={{ marginTop: 4, fontFamily: "var(--font-mono)" }}>{f.model.description}</div>}
          </div>

          {f.model && (
            <div style={{ marginTop: 10 }}>
              <table className="qz-table">
                <thead>
                  <tr>
                    <th>param</th>
                    <th>start</th>
                    <th>lower</th>
                    <th>upper</th>
                  </tr>
                </thead>
                <tbody>
                  {f.model.param_names.map((name, i) => (
                    <tr key={name}>
                      <td>{name}</td>
                      <td>
                        <NumberField aria-label={`Start ${name}`} value={f.p0[i] ?? ""} width={84} onChange={(v) => f.setBound("p0", i, v)} />
                      </td>
                      <td>
                        <NumberField aria-label={`Lower bound ${name}`} value={f.lower[i] ?? ""} width={72} placeholder="none" onChange={(v) => f.setBound("lower", i, v)} />
                      </td>
                      <td>
                        <NumberField aria-label={`Upper bound ${name}`} value={f.upper[i] ?? ""} width={72} placeholder="none" onChange={(v) => f.setBound("upper", i, v)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Button variant="primary" size="sm" disabled={f.busy || f.guessing || !f.model} title={f.guessing ? "Estimating start values…" : undefined} onClick={() => void f.fit()}>
              {f.busy ? "Fitting…" : "Fit"}
            </Button>
            <Button size="sm" disabled={f.busy || !f.model} title="Re-estimate the start values from the data" onClick={f.resetGuess}>
              Auto guess
            </Button>
          </div>

          {f.error && (
            <div className="qzk-ds-meta" role="alert" style={{ marginTop: 10, color: "var(--warn)" }}>
              {f.error}
            </div>
          )}

          {r && (
            <>
              <div style={{ marginTop: 12 }}>
                <DataTable
                  columns={["param", "value", "± SE", `${pct} low`, `${pct} high`]}
                  rows={r.param_names.map((name, i) => [
                    name,
                    fmt(r.params[i]),
                    r.fixed[i] ? "fixed" : fmt(r.inference[i]?.error),
                    fmt(r.inference[i]?.lcl),
                    fmt(r.inference[i]?.ucl),
                  ])}
                />
              </div>
              <div style={{ marginTop: 8 }}>
                <DataTable
                  columns={["stat", "value"]}
                  rows={[
                    ["N points", String(r.n_points)],
                    ["degrees of freedom", String(r.dof)],
                    ["R²", fmt(r.r2)],
                    ["RMSE", fmt(r.rmse)],
                    ["reduced χ²", fmt(r.chi_sq_red)],
                  ]}
                />
              </div>
              {r.exit_flag === 0 && (
                <div className="qzk-ds-meta" role="status" style={{ marginTop: 6, color: "var(--warn)" }}>
                  The optimiser stopped at its iteration limit, so the fit may not have converged. Try other start values.
                </div>
              )}
              {r.dof <= 0 && (
                <div className="qzk-ds-meta" role="status" style={{ marginTop: 6, color: "var(--warn)" }}>
                  Not enough points for standard errors: the fit has as many parameters as data.
                </div>
              )}

              <div style={{ marginTop: 12 }}>
                <div className="qzk-field-lbl">Residual map (data − model)</div>
                {f.points && <SurfaceResidualMap x={f.points.x} y={f.points.y} residuals={r.residuals} xLabel={f.labels.x} yLabel={f.labels.y} />}
                <div className="qzk-ds-meta" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                  <span style={{ fontFamily: "var(--font-mono)" }}>−{fmt(residualScale(r.residuals))}</span>
                  <span aria-hidden="true" style={{ flex: 1, height: 8, background: RAMP, borderRadius: 2 }} />
                  <span style={{ fontFamily: "var(--font-mono)" }}>+{fmt(residualScale(r.residuals))}</span>
                </div>
              </div>

              <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
                <Button size="sm" title="Copy the results as tab-separated text (pastes into Excel)" onClick={() => void f.copyResults(false)}>
                  Copy
                </Button>
                <Button size="sm" title="Copy the results as a Markdown table" onClick={() => void f.copyResults(true)}>
                  Copy MD
                </Button>
                <Button size="sm" disabled={!!f.addDisabledReason} title={f.addDisabledReason ?? "Add X, Y, the fitted Z, the data Z and the residual as a new dataset"} onClick={f.addFittedSurface}>
                  {f.replacing ? `Replace “${f.replacing}”` : "Add fitted surface as dataset"}
                </Button>
              </div>
            </>
          )}
          <SurfaceFitByLevel f={f} />
          <SurfaceFitBatchSection f={f} />
        </>
      )}
    </ToolWindow>
  );
}

/** Remounts the body for each "Open in <tool>" session (it seeds once, at mount). */
export default function SurfaceFitPanel() {
  return <SurfaceFitPanelBody key={useReopenScope("surface-fit")} />;
}
