// Math extras — view. A draggable ToolWindow with eight jobs: the area a curve
// encloses, the surface area of a map, resampling a curve by arc length,
// B-spline resampling, interpolating 2-D / 3-D data onto chosen points, 2-D
// correlation of two maps, solving f(x) = 0 in a bracket and minimising over a
// box. Areas and the solver answer with a result card; the others also add a
// NEW dataset. Thin: the logic is in useMathExtras and mathExtrasRun.

import ToolWindow from "../../overlays/ToolWindow";
import { Button, Select } from "../../primitives";
import { useAnalysisExtras } from "../../../store/analysisExtras";
import { ModeFields } from "./MathExtrasFields";
import { MODES, type MathMode } from "./mathExtrasForm";
import { useMathExtras } from "./useMathExtras";

function MathExtrasBody() {
  const hide = useAnalysisExtras((s) => s.hide);
  const m = useMathExtras();
  const needsData = m.input !== "none";
  const makes = m.mode !== "polygon-area" && m.mode !== "surface-area" && m.input !== "none";
  return (
    <ToolWindow id="math-extras" title="Math extras" width={360} onClose={() => hide("math-extras")}>
      <label className="qzk-field-lbl">Job</label>
      <Select aria-label="Math job" options={MODES.map((o) => ({ value: o.value, label: o.label }))} value={m.mode} onChange={(e) => m.setMode(e.target.value as MathMode)} />
      {needsData && !m.hasActive ? (
        <div className="qzk-helptext" style={{ marginTop: 8 }}>Load a worksheet or a 2-D map to use this.</div>
      ) : (
        <>
          <div style={{ marginTop: 8 }}>
            <ModeFields m={m} />
          </div>
          <Button variant="primary" size="sm" disabled={m.busy} onClick={() => void m.run()} style={{ marginTop: 12, width: "100%" }}>
            {m.busy ? "Computing…" : makes ? "Apply → new dataset" : "Calculate"}
          </Button>
          {m.busy && (
            <Button size="sm" onClick={m.cancel} style={{ marginTop: 6, width: "100%" }}>
              Cancel
            </Button>
          )}
        </>
      )}
      {m.error && (
        <div className="qzk-ds-meta" role="alert" style={{ marginTop: 8, color: "var(--danger)" }}>
          {m.error}
        </div>
      )}
      {m.card && (
        <div role="status" aria-label="Result" style={{ marginTop: 12 }}>
          <div className="qzk-field-lbl">{m.card.title}</div>
          <table style={{ width: "100%", fontFamily: "var(--font-mono)", fontSize: 12 }}>
            <tbody>
              {m.card.rows.map(([k, v]) => (
                <tr key={k}>
                  <td style={{ color: "var(--text-faint)" }}>{k}</td>
                  <td style={{ textAlign: "right" }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {m.card.note && <div className="qzk-helptext" style={{ marginTop: 6, color: "var(--text-faint)" }}>{m.card.note}</div>}
        </div>
      )}
    </ToolWindow>
  );
}

export default function MathExtrasPanel() {
  return <MathExtrasBody />;
}
