// Map stack fit — view. Fit one model to the curve each pixel traces through a
// stack of maps (a series at different temperatures, times, fields...). The
// result is one new map per parameter, plus its standard error, the reduced
// chi-square and a converged flag, all linked to the maps of the stack.
// Thin — the logic is in useMapStackFit.

import ToolWindow from "../../overlays/ToolWindow";
import { Button, Select } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import { NumberField } from "../../primitives/NumberField";
import { useAnalysisExtras } from "../../../store/analysisExtras";
import { LayerRows, ParamRows } from "./StackFields";
import { useMapStackFit } from "./useMapStackFit";

const gap = { marginTop: 8 } as const;

export default function MapStackFitPanel() {
  const hide = useAnalysisExtras((s) => s.hide);
  const m = useMapStackFit();
  const shapes = new Set(m.maps.filter((d) => m.selected.includes(d.id)).map((d) => d.shape));
  return (
    <ToolWindow id="map-stack-fit" title="Map stack fit" width={380} onClose={() => hide("map-stack-fit")}>
      {m.maps.length < 3 ? (
        <div className="qzk-helptext">A stack needs at least 3 maps on the same grid (a series at different temperatures, times or fields). Load them, then open this tool again.</div>
      ) : (
        <>
          <LayerRows m={m} />
          {shapes.size > 1 && <div className="qzk-ds-meta" role="alert" style={{ ...gap, color: "var(--danger)" }}>The ticked maps have different grid sizes; the fit will refuse them.</div>}
          <label className="qzk-field-lbl" style={gap}>Variable name</label>
          <NumberField aria-label="Variable name" numeric={false} width={120} placeholder="e.g. T (K)" value={m.form.xLabel} onChange={(v) => m.setForm({ xLabel: v })} />
          <label className="qzk-field-lbl" style={gap}>Model</label>
          <Select
            aria-label="Model"
            options={m.models.map((x) => ({ value: x.name, label: `${x.category}: ${x.name}` }))}
            value={m.form.model}
            onChange={(e) => m.setModel(e.target.value)}
          />
          {m.model && <ParamRows m={m} model={m.model} />}
          <div style={gap}>
            <Checkbox checked={m.form.keepUnconverged} onChange={(v) => m.setForm({ keepUnconverged: v })}>Keep fits that did not converge (flagged 0)</Checkbox>
          </div>
          <Button variant="primary" size="sm" disabled={m.busy || !m.model} onClick={() => void m.run()} style={{ marginTop: 12, width: "100%" }}>
            {m.busy ? `Fitting… ${Math.round(m.progress * 100)}%` : "Fit every pixel → new maps"}
          </Button>
          {m.busy && (
            <>
              <div className="qzk-ds-meta" style={gap}>{m.message}</div>
              <Button size="sm" onClick={m.cancel} style={{ marginTop: 6, width: "100%" }}>Cancel</Button>
            </>
          )}
          {m.error && <div className="qzk-ds-meta" role="alert" style={{ ...gap, color: "var(--danger)" }}>{m.error}</div>}
          {m.summary.length > 0 && !m.error && (
            <div className="qzk-ds-meta" aria-label="Result" style={gap}>
              {m.summary.map((l) => <div key={l}>{l}</div>)}
            </div>
          )}
        </>
      )}
    </ToolWindow>
  );
}
