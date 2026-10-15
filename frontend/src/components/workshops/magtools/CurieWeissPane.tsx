import { Button, Select } from "../../primitives";
import { NumberField } from "../../primitives/NumberField";
import { fmtNum } from "../../../lib/format";
import { MASS_UNITS, type MassUnit } from "../../../lib/sampleGeometry";
import { useCurieWeiss } from "./useCurieWeiss";
import type { CurieWeissBasisChoice } from "./curieWeissData";

const BASIS_OPTIONS = [
  { value: "auto", label: "Auto-detect from unit" },
  { value: "molar", label: "Selected Y is molar χ" },
  { value: "moment", label: "Derive χ from moment" },
];

export default function CurieWeissPane() {
  const c = useCurieWeiss();
  const responseLabel = c.active?.data.labels[c.yKey] ?? "response";
  const responseUnit = c.active?.data.units[c.yKey] ?? "";
  const rawMoment = c.basis === "total_moment" || c.basis === "mass_moment";

  return (
    <div style={{ marginTop: 12 }}>
      <div className="qzk-ds-meta" style={{ color: "var(--text-faint)", marginBottom: 10 }}>
        Fits 1/χ against temperature and creates an editable inverse-susceptibility worksheet.
        Effective moment requires molar χ in cm³/mol.
      </div>
      <label className="qzk-field-lbl" htmlFor="cw-basis">Selected Y: {responseLabel} {responseUnit && `(${responseUnit})`}</label>
      <Select
        id="cw-basis"
        options={BASIS_OPTIONS}
        value={c.basisChoice}
        onChange={(event) => c.setBasisChoice(event.target.value as CurieWeissBasisChoice)}
      />

      {rawMoment && (
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 10px", alignItems: "center", marginTop: 12 }}>
          <label className="qzk-field-lbl" htmlFor="cw-field">Applied field</label>
          <Select
            id="cw-field"
            options={[
              { value: "", label: "Choose field column…" },
              ...c.fields.map((field) => ({ value: String(field.index), label: `${field.label} (${field.unit})` })),
            ]}
            value={c.selectedField ? String(c.selectedField.index) : ""}
            onChange={(event) => c.setFieldKey(event.target.value === "" ? null : Number(event.target.value))}
          />
          {c.basis === "total_moment" && <>
            <label className="qzk-field-lbl" htmlFor="cw-sample-mass">Sample mass</label>
            <span style={{ display: "inline-flex", gap: 6 }}>
              <NumberField id="cw-sample-mass" value={c.sampleMass} width={82} min={0}
                onChange={(value) => c.setSampleMass(Number(value) || 0)} />
              <Select aria-label="Curie-Weiss sample mass unit"
                options={MASS_UNITS.map((unit) => ({ value: unit, label: unit }))}
                value={c.massUnit} onChange={(event) => c.setMassUnit(event.target.value as MassUnit)} />
            </span>
          </>}
          <label className="qzk-field-lbl" htmlFor="cw-molar-mass">Molar mass</label>
          <NumberField id="cw-molar-mass" value={c.molarMass} width={100} min={0} unit="g/mol"
            onChange={(value) => c.setMolarMass(Number(value) || 0)} />
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 10px", alignItems: "center", marginTop: 12 }}>
        <label className="qzk-field-lbl" htmlFor="cw-fit-min">Fit T minimum</label>
        <NumberField id="cw-fit-min" value={c.fitMin} width={100} unit="K"
          onChange={(value) => c.setFitMin(Number(value))} />
        <label className="qzk-field-lbl" htmlFor="cw-fit-max">Fit T maximum</label>
        <NumberField id="cw-fit-max" value={c.fitMax} width={100} unit="K"
          onChange={(value) => c.setFitMax(Number(value))} />
      </div>
      <div className="qzk-ds-meta" style={{ marginTop: 6, color: "var(--text-faint)" }}>
        Defaults to the upper 40% of the temperature span (at least three rows); adjust this to the visibly linear paramagnetic region.
      </div>

      <div style={{ marginTop: 12 }}>
        <Button variant="primary" size="sm" disabled={c.busy || c.problem !== null} onClick={() => void c.fit()}>
          {c.busy ? "Fitting…" : "Create Curie–Weiss fit →"}
        </Button>
      </div>
      {c.problem && <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--warn, #c90)" }}>{c.problem}</div>}
      {c.theta != null && <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--text-faint)" }}>
        θ<sub>CW</sub> = {fmtNum(c.theta)} K · C = {fmtNum(c.curie ?? Number.NaN)} cm³·K/mol ·
        μ<sub>eff</sub> = {fmtNum(c.moment ?? Number.NaN)} μ<sub>B</sub> · R² = {fmtNum(c.r2 ?? Number.NaN)} · n = {c.nFit}
      </div>}
      {c.warning && <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--warn, #c90)" }}>{c.warning}</div>}
      {c.error && <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--danger)" }}>{c.error}</div>}
    </div>
  );
}
