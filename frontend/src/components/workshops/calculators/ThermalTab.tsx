// Calculators ▸ Thermal tab — Wiedemann-Franz law / Debye temperature /
// thermal diffusivity (calc.thermal, ported from DiraCulator buildThermalTab).
// Self-contained: owns its own local state so the shared useCalculators hook
// stays under the ceiling.

import { useState } from "react";

import { Button, NumberField } from "../../primitives";
import {
  thermalDebye,
  thermalDiffusivity,
  thermalWiedemannFranz,
} from "../../../lib/api";
import { fmtNum } from "../../../lib/format";
import { useCalcHistory } from "../../../store/calcHistory";

const DOMAIN = "Thermal";

/** A titled group of inputs + a result line, mirroring the MATLAB cards. */
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        border: "1px solid var(--border-soft)",
        borderRadius: 6,
        padding: "8px 10px",
        marginTop: 10,
      }}
    >
      <div className="qzk-field-lbl" style={{ marginTop: 0, marginBottom: 6 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  width = 84,
  unit,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  width?: number;
  unit?: string;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span className="qzk-field-lbl" style={{ margin: 0 }}>
        {label}
      </span>
      <NumberField value={value} width={width} onChange={onChange} unit={unit} />
    </span>
  );
}

const ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};
const RESULT: React.CSSProperties = {
  marginTop: 8,
  fontFamily: "var(--font-mono)",
  fontSize: "var(--font-size-lg)",
};
const ERR: React.CSSProperties = { marginTop: 8, color: "var(--danger)" };

export default function ThermalTab() {
  // Card 1 — Wiedemann-Franz law.
  const [sigma, setSigma] = useState("6e5");
  const [wfT, setWfT] = useState("300");
  const [c1, setC1] = useState<{ text: string; err?: boolean } | null>(null);

  // Card 2 — Debye temperature.
  const [vs, setVs] = useState("5000");
  const [nDens, setNDens] = useState("5e28");
  const [c2, setC2] = useState<{ text: string; err?: boolean } | null>(null);

  // Card 3 — thermal diffusivity.
  const [kappa, setKappa] = useState("150");
  const [rho, setRho] = useState("2329");
  const [cp, setCp] = useState("700");
  const [c3, setC3] = useState<{ text: string; err?: boolean } | null>(null);

  async function run(
    setter: (r: { text: string; err?: boolean } | null) => void,
    label: string,
    fn: () => Promise<string>,
  ): Promise<void> {
    try {
      const text = await fn();
      setter({ text });
      useCalcHistory.getState().record({ domain: DOMAIN, label, summary: text });
    } catch (e) {
      setter({ text: e instanceof Error ? e.message : "calculation failed", err: true });
    }
  }

  const result = (r: { text: string; err?: boolean } | null) =>
    r && <div style={r.err ? ERR : RESULT}>{r.text}</div>;

  return (
    <div style={{ marginTop: 12 }}>
      <Card title="Wiedemann-Franz law">
        <div style={ROW}>
          <Field label="σ" value={sigma} onChange={setSigma} unit="S/cm" />
          <Field label="T" value={wfT} onChange={setWfT} unit="K" />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC1, "Wiedemann-Franz law", async () => {
                const r = await thermalWiedemannFranz(Number(sigma), Number(wfT));
                return `κ = ${fmtNum(r.kappa)} W/(m·K)`;
              })
            }
          >
            =
          </Button>
        </div>
        {result(c1)}
      </Card>

      <Card title="Debye temperature">
        <div style={ROW}>
          <Field label="v_s" value={vs} onChange={setVs} unit="m/s" />
          <Field label="n" value={nDens} onChange={setNDens} unit="m⁻³" />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC2, "Debye temperature", async () => {
                const r = await thermalDebye(Number(vs), Number(nDens));
                return `Θ_D = ${fmtNum(r.theta_D)} K`;
              })
            }
          >
            =
          </Button>
        </div>
        {result(c2)}
      </Card>

      <Card title="Thermal diffusivity">
        <div style={ROW}>
          <Field label="κ" value={kappa} onChange={setKappa} unit="W/m·K" width={72} />
          <Field label="ρ" value={rho} onChange={setRho} unit="kg/m³" width={72} />
        </div>
        <div style={{ ...ROW, marginTop: 8 }}>
          <Field label="c_p" value={cp} onChange={setCp} unit="J/kg·K" width={72} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC3, "Thermal diffusivity", async () => {
                const r = await thermalDiffusivity(Number(kappa), Number(rho), Number(cp));
                return `α = ${fmtNum(r.alpha)} m²/s = ${fmtNum(r.alpha_mm2)} mm²/s`;
              })
            }
          >
            =
          </Button>
        </div>
        {result(c3)}
      </Card>
    </div>
  );
}
