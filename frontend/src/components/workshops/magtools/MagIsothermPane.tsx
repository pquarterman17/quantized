import { Button } from "../../primitives";
import { NumberField } from "../../primitives/NumberField";
import { SegmentedControl } from "../../primitives/SegmentedControl";
import type { IsothermView } from "../../../store/magIsothermRun";
import { OutOfDateNote } from "../workbench/WorkbenchParts";
import type { MagIsothermState } from "./useMagIsotherms";

const grid = { display: "grid", gridTemplateColumns: "1fr auto", gap: "6px 10px", alignItems: "center", marginTop: 8 } as const;

export default function MagIsothermPane({ s }: { s: MagIsothermState }) {
  const entropy = s.view === "entropy";
  return (
    <div style={{ marginTop: 12 }}>
      <SegmentedControl<IsothermView>
        options={[{ value: "entropy", label: "ΔS_M(T)" }, { value: "arrott", label: "Arrott plot" }]}
        value={s.view} onChange={s.setView} />
      <div className="qzk-helptext" style={{ color: "var(--text-faint)", margin: "10px 0" }}>
        Each worksheet selected in the Library (active one first) is one M(H) isotherm of the response
        {s.channel ? ` "${s.channel}"` : ""}, read on its own declared field axis and converted to one unit. Use one
        monotonic branch from zero field. {entropy
          ? "ΔS_M(T) is the Maxwell relation between adjacent isotherms (trapezoid integral from 0 to the chosen maximum field); the relative cooling power uses the half-maximum width and carries no ±."
          : "Isotherms are fitted as M^(1/β) against (H/M)^(1/γ) over the field window (mean-field β = 0.5, γ = 1 by default; exponents are inputs, never fitted); Tc is where the intercept changes sign."}{" "}
        A ± appears only when every worksheet has one committed symmetric M uncertainty column: it is a
        first-order (linear) propagation of the per-point uncertainty, points independent, field and temperature
        exact. Otherwise no ± is shown. Settings are provisional, owner to confirm.
      </div>
      <div className="qzk-field-lbl">Temperature of each isotherm (K)</div>
      <div style={grid}>
        {s.rows.map((r) => (
          <div key={r.id} style={{ display: "contents" }}>
            <label className="qzk-ds-meta" htmlFor={`iso-t-${r.id}`} title={r.name}>{r.name}{r.fromColumn ? " (from its temperature column)" : ""}</label>
            <NumberField id={`iso-t-${r.id}`} value={r.text} width={82} unit="K" onChange={(v) => s.setTemp(r.id, v)} />
          </div>
        ))}
      </div>
      <div style={grid}>
        {entropy ? (
          <>
            <label className="qzk-field-lbl" htmlFor="iso-fields">Maximum field(s){s.fieldUnit ? ` (${s.fieldUnit})` : ""}</label>
            <NumberField id="iso-fields" numeric={false} value={s.fieldsText} width={110} placeholder="e.g. 1, 3, 5" onChange={s.setFieldsText} />
          </>
        ) : (
          <>
            <label className="qzk-field-lbl" htmlFor="iso-lo">Field window low{s.fieldUnit ? ` (${s.fieldUnit})` : ""}</label>
            <NumberField id="iso-lo" value={s.lo} width={100} onChange={s.setLo} />
            <label className="qzk-field-lbl" htmlFor="iso-hi">Field window high{s.fieldUnit ? ` (${s.fieldUnit})` : ""}</label>
            <NumberField id="iso-hi" value={s.hi} width={100} onChange={s.setHi} />
            <label className="qzk-field-lbl" htmlFor="iso-beta">β</label>
            <NumberField id="iso-beta" value={s.beta} width={64} onChange={s.setBeta} />
            <label className="qzk-field-lbl" htmlFor="iso-gamma">γ</label>
            <NumberField id="iso-gamma" value={s.gamma} width={64} onChange={s.setGamma} />
          </>
        )}
      </div>
      <div style={{ marginTop: 12 }}>
        <Button variant="primary" size="sm" disabled={s.busy || s.problem !== null} onClick={() => void s.run()}>
          {s.busy ? "Working…" : `Create ${entropy ? "ΔS_M(T)" : "Arrott"} worksheet from ${s.count} isotherms →`}
        </Button>
      </div>
      {s.problem && <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--warn, #c90)" }}>{s.problem}</div>}
      {s.stale && <OutOfDateNote block>the selection, data or settings changed after the last run. Create it again.</OutOfDateNote>}
      {s.shown && s.shown.lines.length > 0 && (
        <ul className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--text-faint)", paddingLeft: 16 }}>
          {s.shown.lines.map((line) => <li key={line}>{line}</li>)}
        </ul>
      )}
      {s.shown?.warning && <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--warn, #c90)" }}>{s.shown.warning}</div>}
      {s.shown?.error && <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--danger)" }}>{s.shown.error}</div>}
    </div>
  );
}
