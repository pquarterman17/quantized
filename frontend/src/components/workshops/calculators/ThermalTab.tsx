// Calculators ▸ Thermal tab — Wiedemann-Franz law / Debye temperature /
// thermal diffusivity (calc.thermal, ported from DiraCulator buildThermalTab).
// Self-contained: owns its own local state so the shared useCalculators hook
// stays under the ceiling.

import { useState } from "react";

import { thermalDebye, thermalDiffusivity, thermalWiedemannFranz } from "../../../lib/api/thermal";
import {
  Button,
  Card,
  Field,
  ROW,
  fmtNum,
  resultLine,
  useCard,
  withTouch,
} from "./shared";

export default function ThermalTab() {
  // Card 1 — Wiedemann-Franz law.
  const [sigma, setSigma] = useState("6e5");
  const [wfT, setWfT] = useState("300");
  const c1 = useCard("Thermal");

  // Card 2 — Debye temperature.
  const [vs, setVs] = useState("5000");
  const [nDens, setNDens] = useState("5e28");
  const c2 = useCard("Thermal");

  // Card 3 — thermal diffusivity.
  const [kappa, setKappa] = useState("150");
  const [rho, setRho] = useState("2329");
  const [cp, setCp] = useState("700");
  const c3 = useCard("Thermal");

  return (
    <div style={{ marginTop: 12 }}>
      <Card title="Wiedemann-Franz law">
        <div style={ROW}>
          <Field label="σ" value={sigma} onChange={withTouch(c1.touch, setSigma)} unit="S/cm" />
          <Field label="T" value={wfT} onChange={withTouch(c1.touch, setWfT)} unit="K" />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void c1.run("Wiedemann-Franz law", `σ=${sigma} S/cm, T=${wfT} K`, async () => {
                const r = await thermalWiedemannFranz(Number(sigma), Number(wfT));
                return `κ = ${fmtNum(r.kappa)} W/(m·K)`;
              })
            }
          >
            =
          </Button>
        </div>
        {resultLine(c1.result)}
      </Card>

      <Card title="Debye temperature">
        <div style={ROW}>
          <Field label="v_s" value={vs} onChange={withTouch(c2.touch, setVs)} unit="m/s" />
          <Field label="n" value={nDens} onChange={withTouch(c2.touch, setNDens)} unit="m⁻³" />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void c2.run("Debye temperature", `v_s=${vs} m/s, n=${nDens} m⁻³`, async () => {
                const r = await thermalDebye(Number(vs), Number(nDens));
                return `Θ_D = ${fmtNum(r.theta_D)} K`;
              })
            }
          >
            =
          </Button>
        </div>
        {resultLine(c2.result)}
      </Card>

      <Card title="Thermal diffusivity">
        <div style={ROW}>
          <Field label="κ" value={kappa} onChange={withTouch(c3.touch, setKappa)} unit="W/m·K" width={72} />
          <Field label="ρ" value={rho} onChange={withTouch(c3.touch, setRho)} unit="kg/m³" width={72} />
        </div>
        <div style={{ ...ROW, marginTop: 8 }}>
          <Field label="c_p" value={cp} onChange={withTouch(c3.touch, setCp)} unit="J/kg·K" width={72} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void c3.run("Thermal diffusivity", `κ=${kappa} W/m·K, ρ=${rho} kg/m³, c_p=${cp} J/kg·K`, async () => {
                const r = await thermalDiffusivity(Number(kappa), Number(rho), Number(cp));
                return `α = ${fmtNum(r.alpha)} m²/s = ${fmtNum(r.alpha_mm2)} mm²/s`;
              })
            }
          >
            =
          </Button>
        </div>
        {resultLine(c3.result)}
      </Card>
    </div>
  );
}
