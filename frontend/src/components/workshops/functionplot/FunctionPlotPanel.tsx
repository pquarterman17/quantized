// Function Plot workshop (Origin's Plot > Function Plot): type y = f(x) with
// named parameters, an x range and a point count, and add it as a curve on the
// focused graph. A selected function curve is edited live. Thin: the state and
// the commit live in useFunctionPlot; the sampling in lib/functionPlot.
//
// Not offered: taking parameter values from the last fit (the fit models are
// not formula expressions); type the fitted values into the parameter boxes.

import ToolWindow from "../../overlays/ToolWindow";
import { Button, Select } from "../../primitives";
import BufferedNumberField from "../../primitives/BufferedNumberField";
import { useApp } from "../../../store/useApp";
import { useFunctionPlot } from "./useFunctionPlot";

export default function FunctionPlotPanel() {
  const setOpen = useApp((s) => s.setDatasetMathOpen);
  const m = useFunctionPlot();
  const editing = m.selectedId !== "";
  return (
    <ToolWindow id="functionplot" title="Function Plot" width={340} onClose={() => setOpen(false)}>
      <label className="qzk-field-lbl">Curve</label>
      <Select
        aria-label="Function curve"
        options={[{ value: "", label: "New function curve" }, ...m.curves.map((c) => ({ value: c.id, label: c.name }))]}
        value={m.selectedId}
        onChange={(e) => m.select(e.target.value)}
      />

      <label className="qzk-field-lbl" style={{ marginTop: 8 }}>
        y =
      </label>
      <input
        className="qz-input"
        aria-label="Function expression"
        spellCheck={false}
        value={m.expr}
        onChange={(e) => m.setExpr(e.target.value)}
        placeholder="a*sin(b*x)+c"
        style={{ width: "100%" }}
      />

      {m.paramNames.length > 0 && (
        <>
          <label className="qzk-field-lbl" style={{ marginTop: 8 }}>
            Parameters
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {m.paramNames.map((p) => (
              <label key={p} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span className="qzk-ds-meta">{p}</span>
                <BufferedNumberField aria-label={`Parameter ${p}`} value={m.params[p]} onValue={(v) => m.setParam(p, v)} width={64} />
              </label>
            ))}
          </div>
        </>
      )}

      <label className="qzk-field-lbl" style={{ marginTop: 8 }}>
        x from / to / points
      </label>
      <div style={{ display: "flex", gap: 6 }}>
        <BufferedNumberField aria-label="x min" value={m.xMin} onValue={m.setXMin} width={72} />
        <BufferedNumberField aria-label="x max" value={m.xMax} onValue={m.setXMax} width={72} />
        <BufferedNumberField aria-label="Points" value={m.n} onValue={m.setN} width={64} />
      </div>

      {m.problem && (
        <div className="qzk-ds-meta" role="alert" style={{ marginTop: 6, color: "var(--danger)" }}>
          {m.problem}
        </div>
      )}
      {editing && !m.problem && (
        <div className="qzk-ds-meta" style={{ marginTop: 6, color: "var(--text-faint)" }}>
          Editing live: graphs holding this curve follow.
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        <Button variant="primary" disabled={m.problem !== null} onClick={m.add}>
          {editing ? "Add as new curve" : "Add to graph"}
        </Button>
      </div>
    </ToolWindow>
  );
}
