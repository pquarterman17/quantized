// Calculators ▸ SLD tab — neutron + X-ray scattering-length density from a
// chemical formula, mass density, and probe wavelengths (real + imaginary /
// absorption). Backed by calc.sld_formula (periodictable, the NIST NCNR engine).
// Presentational; state in the useCalculators hook.

import type { ReactNode } from "react";

import type { SldProbe } from "../../../lib/api";
import { Button, NumberField, Pill } from "../../primitives";
import { fmtNum } from "../../../lib/format";
import {
  NEUTRON_WAVELENGTHS,
  SLD_PRESETS,
  WAVELENGTHS,
  type CalculatorsState,
} from "./useCalculators";

/** 1/e penetration depth (cm) → a human-friendly cm / mm / µm string. */
function depthStr(cm: number): string {
  if (!Number.isFinite(cm)) return "∞";
  if (cm >= 1) return `${fmtNum(cm)} cm`;
  if (cm >= 0.1) return `${fmtNum(cm * 10)} mm`;
  return `${fmtNum(cm * 1e4)} µm`;
}

const SLD_UNIT = "×10⁻⁶ Å⁻²";

/** One probe's results (neutron or X-ray): real + imaginary SLD, Qc, 1/e depth. */
function ProbeBlock({
  title,
  p,
  extra,
}: {
  title: string;
  p: SldProbe;
  extra?: ReactNode;
}) {
  return (
    <div style={{ marginTop: 12 }}>
      <div className="qzk-field-lbl">
        {title} <span style={{ color: "var(--text-faint)" }}>(λ {fmtNum(p.wavelength)} Å)</span>
      </div>
      <div style={{ fontFamily: "var(--font-mono)", marginTop: 4 }}>
        <div style={{ fontSize: "var(--font-size-lg)" }}>
          {fmtNum(p.sld_real)} <span style={{ color: "var(--text-dim)" }}>{SLD_UNIT}</span>
        </div>
        <div style={{ color: "var(--text-dim)", marginTop: 2 }}>
          + i {fmtNum(p.sld_imag)} {SLD_UNIT} <span style={{ color: "var(--text-faint)" }}>(abs)</span>
        </div>
        <div style={{ color: "var(--text-dim)", marginTop: 4 }}>
          Qc = {fmtNum(p.qc)} Å⁻¹ · 1/e = {depthStr(p.penetration)}
        </div>
        {extra}
      </div>
    </div>
  );
}

export default function SldTab({ c }: { c: CalculatorsState }) {
  const r = c.sldResult;
  return (
    <div style={{ marginTop: 12 }}>
      {/* Material presets (formula + density) */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {SLD_PRESETS.map((m) => (
          <Pill
            key={m.label}
            active={c.sld.formula === m.formula && Number(c.sld.density) === m.density}
            onClick={() => c.setSldPreset(m.formula, m.density)}
          >
            {m.label}
          </Pill>
        ))}
      </div>

      {/* Formula + density */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        <span className="qzk-field-lbl" style={{ margin: 0 }}>
          formula
        </span>
        <NumberField
          numeric={false}
          value={c.sld.formula}
          width={92}
          onChange={(v) => c.updSld({ formula: v })}
          aria-label="chemical formula"
        />
        <span className="qzk-field-lbl" style={{ margin: 0 }}>
          ρ
        </span>
        <NumberField value={c.sld.density} width={64} onChange={(v) => c.updSld({ density: v })} />
        <span style={{ color: "var(--text-faint)" }}>g/cm³</span>
      </div>

      {/* Neutron wavelength */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
        <span className="qzk-field-lbl" style={{ margin: 0 }}>
          λn
        </span>
        <NumberField
          value={c.sld.neutronWavelength}
          width={72}
          onChange={(v) => c.updSld({ neutronWavelength: v })}
        />
        <span style={{ color: "var(--text-faint)" }}>Å</span>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
        {NEUTRON_WAVELENGTHS.map((w) => (
          <Pill
            key={w.label}
            active={Number(c.sld.neutronWavelength) === w.a}
            onClick={() => c.updSld({ neutronWavelength: String(w.a) })}
          >
            {w.label}
          </Pill>
        ))}
      </div>

      {/* X-ray wavelength */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
        <span className="qzk-field-lbl" style={{ margin: 0 }}>
          λx
        </span>
        <NumberField
          value={c.sld.xrayWavelength}
          width={72}
          onChange={(v) => c.updSld({ xrayWavelength: v })}
        />
        <span style={{ color: "var(--text-faint)" }}>Å</span>
        <Button variant="primary" size="sm" disabled={c.sldBusy} onClick={() => void c.sldCompute()}>
          =
        </Button>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
        {WAVELENGTHS.map((w) => (
          <Pill
            key={w.label}
            active={Number(c.sld.xrayWavelength) === w.a}
            onClick={() => c.updSld({ xrayWavelength: String(w.a) })}
          >
            {w.label}
          </Pill>
        ))}
      </div>

      {/* Results */}
      {r && !c.sldError && (
        <>
          <ProbeBlock
            title="Neutron SLD"
            p={r.neutron}
            extra={
              r.neutron.xs_absorption != null ? (
                <div style={{ color: "var(--text-faint)", marginTop: 2 }}>
                  σabs = {fmtNum(r.neutron.xs_absorption)} cm⁻¹ · σinc ={" "}
                  {fmtNum(r.neutron.xs_incoherent ?? 0)} cm⁻¹
                </div>
              ) : null
            }
          />
          <ProbeBlock title="X-ray SLD" p={r.xray} />
          <div className="qzk-ds-meta" style={{ marginTop: 12, color: "var(--text-faint)" }}>
            {r.formula} · M = {fmtNum(r.molar_mass)} g/mol · n = {fmtNum(r.number_density)} cm⁻³
          </div>
        </>
      )}
      {c.sldError && (
        <div className="qzk-ds-meta" style={{ marginTop: 12, color: "var(--danger)" }}>
          {c.sldError}
        </div>
      )}
    </div>
  );
}
