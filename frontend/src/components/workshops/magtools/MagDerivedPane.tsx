import { Button, Select } from "../../primitives";
import { NumberField } from "../../primitives/NumberField";
import { MASS_UNITS, type MassUnit } from "../../../lib/sampleGeometry";
import type { SusceptibilityOutput } from "../../../lib/api/magnetic";
import { OutOfDateNote } from "../workbench/WorkbenchParts";
import type { MagDerivedState } from "./useMagDerived";

const OUTPUTS: { value: SusceptibilityOutput; label: string }[] = [
  { value: "volume", label: "Per volume (dimensionless)" },
  { value: "mass", label: "Per mass" },
  { value: "molar", label: "Per mole" },
];

export default function MagDerivedPane({ d }: { d: MagDerivedState }) {
  const total = (d.active?.data.units[d.yKey] ?? "") === "emu" || (d.active?.data.units[d.yKey] ?? "") === "A·m²";
  const needMass = d.output !== "volume" && total;
  const needVolume = d.output === "volume" && total;
  const needMolar = d.output === "molar";
  const grid = { display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 10px", alignItems: "center", marginTop: 12 } as const;
  return (
    <div style={{ marginTop: 12 }}>
      <div className="qzk-helptext" style={{ color: "var(--text-faint)", marginBottom: 10 }}>
        Susceptibility χ = M / H from the selected response, as a new worksheet with its uncertainty
        propagated. A per-volume response cannot become per mass or per mole without a density, so
        that is refused rather than guessed.
      </div>
      <div style={grid}>
        <label className="qzk-field-lbl" htmlFor="md-output">Basis</label>
        <Select id="md-output" options={OUTPUTS} value={d.output} onChange={(e) => d.setOutput(e.target.value as SusceptibilityOutput)} />
        <label className="qzk-field-lbl" htmlFor="md-system">Units</label>
        <Select id="md-system" options={[{ value: "cgs", label: "CGS (emu, Oe)" }, { value: "si", label: "SI (dimensionless / m³)" }]}
          value={d.system} onChange={(e) => d.setSystem(e.target.value as "cgs" | "si")} />
        <label className="qzk-field-lbl" htmlFor="md-field">Applied field</label>
        <Select id="md-field"
          options={[{ value: "", label: "Choose field…" }, ...d.choices.map((c) => ({ value: d.fieldId(c), label: `${c.kind === "x" ? "X axis" : c.label} (${c.unit})` }))]}
          value={d.selected ? d.fieldId(d.selected) : ""} onChange={(e) => d.setFieldPick(e.target.value === "" ? null : e.target.value)} />
        {needMass && <>
          <label className="qzk-field-lbl" htmlFor="md-mass">Sample mass</label>
          <span style={{ display: "inline-flex", gap: 6 }}>
            <NumberField id="md-mass" value={d.mass} width={82} min={0} onChange={(v) => d.setMass(Number(v) || 0)} />
            <Select aria-label="Sample mass unit" options={MASS_UNITS.map((u) => ({ value: u, label: u }))}
              value={d.massUnit} onChange={(e) => d.setMassUnit(e.target.value as MassUnit)} />
          </span>
        </>}
        {needVolume && <>
          <label className="qzk-field-lbl" htmlFor="md-volume">Sample volume</label>
          <NumberField id="md-volume" value={d.volume} width={100} min={0} unit="cm³" onChange={(v) => d.setVolume(Number(v) || 0)} />
        </>}
        {needMolar && <>
          <label className="qzk-field-lbl" htmlFor="md-molar">Molar mass</label>
          <NumberField id="md-molar" value={d.molarMass} width={100} min={0} unit="g/mol" onChange={(v) => d.setMolarMass(Number(v) || 0)} />
        </>}
      </div>
      <div style={{ marginTop: 12 }}>
        <Button variant="primary" size="sm" disabled={d.busy || d.problem !== null} onClick={() => void d.createSusceptibility()}>
          {d.busy ? "Working…" : "Create susceptibility worksheet →"}
        </Button>
      </div>
      {d.problem && <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--warn, #c90)" }}>{d.problem}</div>}
      {d.stale && <OutOfDateNote block>the data, plot or settings changed after the last run. Create it again.</OutOfDateNote>}
      {d.shown?.summary && <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--text-faint)" }}>{d.shown.summary}</div>}
      {d.shown?.warning && <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--warn, #c90)" }}>{d.shown.warning}</div>}
      {d.shown?.error && <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--danger)" }}>{d.shown.error}</div>}
    </div>
  );
}
