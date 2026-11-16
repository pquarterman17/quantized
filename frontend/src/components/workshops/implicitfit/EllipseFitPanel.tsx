// Ellipse fit (implicit curve) — view. Pick the X and Y columns of the points,
// choose the geometric (orthogonal-distance) or the quick algebraic fit, and
// read centre, semi-axes and tilt with standard errors. Logic: useEllipseFit.

import ToolWindow from "../../overlays/ToolWindow";
import { Button, Select } from "../../primitives";
import { DataTable } from "../../primitives/DataTable";
import { fmtNum as fmt } from "../../../lib/format";
import { useAnalysisExtras } from "../../../store/analysisExtras";
import { pickOptions } from "../analysisextras/columnPicks";
import EllipsePlot from "./EllipsePlot";
import { useEllipseFit } from "./useEllipseFit";

const METHODS = [
  { value: "geometric", label: "Geometric (orthogonal distance)" },
  { value: "algebraic", label: "Algebraic only (direct, fast)" },
];

export default function EllipseFitPanel() {
  const hide = useAnalysisExtras((s) => s.hide);
  const e = useEllipseFit();
  const opts = pickOptions(e.columns);
  const r = e.result;

  return (
    <ToolWindow id="ellipse-fit" title="Ellipse fit" width={440} onClose={() => hide("ellipse-fit")}>
      {!e.hasData ? (
        <div className="qzk-helptext">Select a dataset with two columns of points that trace an ellipse or a part of one.</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label className="qzk-field-lbl">X</label>
              <Select aria-label="X column" options={opts} value={String(e.xCol)} onChange={(ev) => e.setXCol(Number(ev.target.value))} />
            </div>
            <div>
              <label className="qzk-field-lbl">Y</label>
              <Select aria-label="Y column" options={opts} value={String(e.yCol)} onChange={(ev) => e.setYCol(Number(ev.target.value))} />
            </div>
          </div>
          <div style={{ marginTop: 8, display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label className="qzk-field-lbl">Method</label>
              <Select aria-label="Method" options={METHODS} value={e.geometric ? "geometric" : "algebraic"} onChange={(ev) => e.setGeometric(ev.target.value === "geometric")} />
            </div>
            <Button variant="primary" size="sm" disabled={e.busy} onClick={() => void e.fit()}>
              {e.busy ? "Fitting…" : "Fit ellipse"}
            </Button>
          </div>
          <div className="qzk-helptext" style={{ marginTop: 6 }}>
            The geometric fit minimises the distance from each point to the curve and gives standard errors; the algebraic fit is the quick starting estimate, biased on short arcs.
          </div>

          {e.error && (
            <div className="qzk-ds-meta" role="alert" style={{ marginTop: 10, color: "var(--warn)" }}>
              {e.error}
            </div>
          )}

          {r && e.points && (
            <>
              <div style={{ marginTop: 12 }}>
                <DataTable
                  columns={["parameter", "value", "± SE"]}
                  rows={[
                    ["center x", fmt(r.center_x), fmt(r.center_x_se)],
                    ["center y", fmt(r.center_y), fmt(r.center_y_se)],
                    ["semi-major a", fmt(r.semi_major), fmt(r.semi_major_se)],
                    ["semi-minor b", fmt(r.semi_minor), fmt(r.semi_minor_se)],
                    ["angle of a (°)", fmt(r.angle_deg), fmt(r.angle_deg_se)],
                  ]}
                />
              </div>
              <div style={{ marginTop: 8 }}>
                <DataTable
                  columns={["stat", "value"]}
                  rows={[
                    ["N points", String(r.n_points)],
                    ["eccentricity", fmt(Math.sqrt(Math.max(0, 1 - (r.semi_minor / r.semi_major) ** 2)))],
                    ["RMS distance to curve", fmt(r.rms)],
                  ]}
                />
              </div>
              {!r.converged && (
                <div className="qzk-ds-meta" role="status" style={{ marginTop: 6, color: "var(--warn)" }}>
                  The refinement stopped before converging. Treat the result with care.
                </div>
              )}
              {r.geometric && r.semi_major_se === null && (
                <div className="qzk-ds-meta" role="status" style={{ marginTop: 6, color: "var(--warn)" }}>
                  Standard errors could not be estimated (too few points, or the points do not constrain the ellipse).
                </div>
              )}
              {r.arc_coverage_deg < 270 && (
                <div className="qzk-ds-meta" role="status" style={{ marginTop: 6, color: "var(--warn)" }}>
                  The points cover only about {Math.round(r.arc_coverage_deg)}° of the curve. A short arc fits many ellipses almost equally well, so trust the standard errors, not just the values.
                </div>
              )}
              {r.semi_minor / r.semi_major > 0.97 && (
                <div className="qzk-ds-meta" role="status" style={{ marginTop: 6 }}>
                  The shape is nearly a circle, so its tilt angle is not well defined.
                </div>
              )}
              <div style={{ marginTop: 10 }}>
                <EllipsePlot x={e.points.x} y={e.points.y} curveX={r.curve_x} curveY={r.curve_y} cx={r.center_x} cy={r.center_y} />
              </div>
              <div style={{ marginTop: 10 }}>
                <Button size="sm" title="Add the fitted ellipse as a dataset to overlay on the points" onClick={e.addEllipse}>
                  Add fitted ellipse as dataset
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </ToolWindow>
  );
}
