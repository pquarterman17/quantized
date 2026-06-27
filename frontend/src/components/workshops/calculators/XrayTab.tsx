// Calculators ▸ X-ray tab — Bragg / Q↔2θ conversions (golden calc.xray).
// Presentational; state in the useCalculators hook. Extracted from the panel.

import { Button, NumberField, Pill, Select } from "../../primitives";
import { fmtNum } from "../../../lib/format";
import { WAVELENGTHS, XRAY_MODES, type CalculatorsState } from "./useCalculators";

export default function XrayTab({ c }: { c: CalculatorsState }) {
  return (
    <div style={{ marginTop: 12 }}>
      <Select
        options={XRAY_MODES.map((m) => ({ value: m.value, label: m.label }))}
        value={c.xrayMode}
        onChange={(e) => c.setXrayMode(e.target.value)}
        aria-label="x-ray conversion"
      />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
        <span className="qzk-field-lbl" style={{ margin: 0 }}>
          λ
        </span>
        <NumberField value={c.wavelength} width={84} onChange={c.setWavelength} />
        <span style={{ color: "var(--text-faint)" }}>Å</span>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
        {WAVELENGTHS.map((w) => (
          <Pill
            key={w.label}
            active={Number(c.wavelength) === w.a}
            onClick={() => c.setWavelength(String(w.a))}
          >
            {w.label}
          </Pill>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        <NumberField value={c.xrayValue} width={100} onChange={c.setXrayValue} />
        <span style={{ color: "var(--text-faint)" }}>
          {XRAY_MODES.find((m) => m.value === c.xrayMode)?.inUnit ?? ""}
        </span>
        <Button variant="primary" size="sm" disabled={c.xrayBusy} onClick={() => void c.xrayCompute()}>
          =
        </Button>
      </div>
      {c.xrayResult && !c.xrayError && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-lg)" }}>
            {fmtNum(c.xrayResult.result)}{" "}
            <span style={{ color: "var(--text-dim)" }}>{c.xrayResult.unit}</span>
          </div>
          <div className="qzk-ds-meta" style={{ marginTop: 4, color: "var(--text-faint)" }}>
            {c.xrayResult.description}
          </div>
        </div>
      )}
      {c.xrayError && (
        <div className="qzk-ds-meta" style={{ marginTop: 12, color: "var(--danger)" }}>
          {c.xrayError}
        </div>
      )}
    </div>
  );
}
