// Calculators ▸ Electrical tab — resistivity / sheet resistance / conductivity /
// mobility / current density / Hall effect (calc.electrical, golden vs MATLAB
// DiraCulator buildElectricalTab). Self-contained: owns its own local state so
// the shared useCalculators hook stays under the ceiling.

import { useState } from "react";

import {
  electricalConductivity,
  electricalCurrentDensity,
  electricalHall,
  electricalMobility,
  electricalResistivity,
  electricalSheetResistance,
} from "../../../lib/api";
import {
  Button,
  Card,
  Field,
  ROW,
  fmtNum,
  makeCardRunner,
  resultLine,
  type CardResult,
} from "./shared";

const run = makeCardRunner("Electrical");

const NM_TO_CM = 1e-7;

export default function ElectricalTab() {
  // Card 1 — resistivity / sheet resistance (t in nm, converted to cm).
  const [rs, setRs] = useState("100");
  const [thick, setThick] = useState("10");
  const [rho1, setRho1] = useState("1e-4");
  const [c1, setC1] = useState<CardResult>(null);

  // Card 2 — conductivity.
  const [rho2, setRho2] = useState("1e-4");
  const [c2, setC2] = useState<CardResult>(null);

  // Card 3 — mobility.
  const [rho3, setRho3] = useState("1e-2");
  const [n3, setN3] = useState("1e17");
  const [c3, setC3] = useState<CardResult>(null);

  // Card 4 — current density.
  const [cur, setCur] = useState("1e-3");
  const [area, setArea] = useState("1");
  const [c4, setC4] = useState<CardResult>(null);

  // Card 5 — Hall effect (t in nm).
  const [vH, setVH] = useState("1e-3");
  const [hallI, setHallI] = useState("1e-3");
  const [hallB, setHallB] = useState("1");
  const [hallT, setHallT] = useState("100");
  const [c5, setC5] = useState<CardResult>(null);

  return (
    <div style={{ marginTop: 12 }}>
      <Card title="Resistivity / Sheet resistance">
        <div style={ROW}>
          <Field label="Rs" value={rs} onChange={setRs} unit="Ω/sq" />
          <Field label="t" value={thick} onChange={setThick} unit="nm" />
          <Button
            size="sm"
            onClick={() =>
              void run(setC1, "Resistivity / Sheet resistance", async () => {
                const r = await electricalResistivity(Number(rs), Number(thick) * NM_TO_CM);
                return `ρ = ${fmtNum(r.rho)} Ω·cm`;
              })
            }
          >
            Rs → ρ
          </Button>
        </div>
        <div style={{ ...ROW, marginTop: 8 }}>
          <Field label="ρ" value={rho1} onChange={setRho1} unit="Ω·cm" />
          <Button
            size="sm"
            onClick={() =>
              void run(setC1, "Resistivity / Sheet resistance", async () => {
                const r = await electricalSheetResistance(Number(rho1), Number(thick) * NM_TO_CM);
                return `Rs = ${fmtNum(r.Rs)} Ω/sq`;
              })
            }
          >
            ρ → Rs
          </Button>
        </div>
        {resultLine(c1)}
      </Card>

      <Card title="Conductivity">
        <div style={ROW}>
          <Field label="ρ" value={rho2} onChange={setRho2} unit="Ω·cm" />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC2, "Conductivity", async () => {
                const r = await electricalConductivity(Number(rho2));
                return `σ = ${fmtNum(r.sigma)} S/cm`;
              })
            }
          >
            =
          </Button>
        </div>
        {resultLine(c2)}
      </Card>

      <Card title="Mobility">
        <div style={ROW}>
          <Field label="ρ" value={rho3} onChange={setRho3} unit="Ω·cm" />
          <Field label="n" value={n3} onChange={setN3} unit="cm⁻³" />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC3, "Mobility", async () => {
                const r = await electricalMobility(Number(rho3), Number(n3));
                return `μ = ${fmtNum(r.mu)} cm²/(V·s)`;
              })
            }
          >
            =
          </Button>
        </div>
        {resultLine(c3)}
      </Card>

      <Card title="Current density">
        <div style={ROW}>
          <Field label="I" value={cur} onChange={setCur} unit="A" />
          <Field label="A" value={area} onChange={setArea} unit="cm²" />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC4, "Current density", async () => {
                const r = await electricalCurrentDensity(Number(cur), Number(area));
                return `J = ${fmtNum(r.J)} A/cm²`;
              })
            }
          >
            =
          </Button>
        </div>
        {resultLine(c4)}
      </Card>

      <Card title="Hall effect">
        <div style={ROW}>
          <Field label="V_H" value={vH} onChange={setVH} unit="V" width={72} />
          <Field label="I" value={hallI} onChange={setHallI} unit="A" width={72} />
        </div>
        <div style={{ ...ROW, marginTop: 8 }}>
          <Field label="B" value={hallB} onChange={setHallB} unit="T" width={72} />
          <Field label="t" value={hallT} onChange={setHallT} unit="nm" width={72} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC5, "Hall effect", async () => {
                const r = await electricalHall(
                  Number(vH),
                  Number(hallI),
                  Number(hallB),
                  Number(hallT) * NM_TO_CM,
                );
                return `R_H = ${fmtNum(r.r_h)} cm³/C · n = ${fmtNum(
                  r.carrier_density,
                )} cm⁻³ · ${r.carrier_type}-type`;
              })
            }
          >
            =
          </Button>
        </div>
        {resultLine(c5)}
      </Card>
    </div>
  );
}
