// Calculators ▸ Electrical tab — resistivity / sheet resistance / conductivity /
// mobility / current density / Hall effect (calc.electrical, golden vs MATLAB
// DiraCulator buildElectricalTab). Self-contained: owns its own local state so
// the shared useCalculators hook stays under the ceiling.

import { useState } from "react";

import { electricalConductivity, electricalCurrentDensity, electricalHall, electricalMobility, electricalResistivity, electricalSheetResistance, electricalHallSweep, electricalVanDerPauw } from "../../../lib/api/electrical";
import {
  Button,
  Card,
  Field,
  ROW,
  fmtNum,
  parseXYPairs,
  resultLine,
  useCard,
  withTouch,
} from "./shared";

const NM_TO_CM = 1e-7;

export default function ElectricalTab() {
  // Card 1 — resistivity / sheet resistance (t in nm, converted to cm).
  const [rs, setRs] = useState("100");
  const [thick, setThick] = useState("10");
  const [rho1, setRho1] = useState("1e-4");
  const c1 = useCard("Electrical");

  // Card 2 — conductivity.
  const [rho2, setRho2] = useState("1e-4");
  const c2 = useCard("Electrical");

  // Card 3 — mobility.
  const [rho3, setRho3] = useState("1e-2");
  const [n3, setN3] = useState("1e17");
  const c3 = useCard("Electrical");

  // Card 4 — current density.
  const [cur, setCur] = useState("1e-3");
  const [area, setArea] = useState("1");
  const c4 = useCard("Electrical");

  // Card 5 — Hall effect (t in nm).
  const [vH, setVH] = useState("1e-3");
  const [hallI, setHallI] = useState("1e-3");
  const [hallB, setHallB] = useState("1");
  const [hallT, setHallT] = useState("100");
  const c5 = useCard("Electrical");

  // Card 6 — Hall sweep (paste H, R_xy), t in nm, optional sigma for mobility.
  const [hsText, setHsText] = useState("");
  const [hsT, setHsT] = useState("100");
  const [hsSigma, setHsSigma] = useState("");
  const c6 = useCard("Electrical");

  // Card 7 — van der Pauw (Ra, Rb; optional thickness in nm).
  const [vdpRa, setVdpRa] = useState("1.0");
  const [vdpRb, setVdpRb] = useState("1.0");
  const [vdpT, setVdpT] = useState("");
  const c7 = useCard("Electrical");

  return (
    <div style={{ marginTop: 12 }}>
      <Card title="Resistivity / Sheet resistance">
        <div style={ROW}>
          <Field label="Rs" value={rs} onChange={withTouch(c1.touch, setRs)} unit="Ω/sq" />
          <Field
            label="t"
            value={thick}
            onChange={withTouch(c1.touch, setThick)}
            unit="nm"
            ariaLabel="Rs/rho thickness"
          />
          <Button
            size="sm"
            onClick={() =>
              void c1.run("Resistivity / Sheet resistance", async () => {
                const r = await electricalResistivity(Number(rs), Number(thick) * NM_TO_CM);
                return `ρ = ${fmtNum(r.rho)} Ω·cm`;
              })
            }
          >
            Rs → ρ
          </Button>
        </div>
        <div style={{ ...ROW, marginTop: 8 }}>
          <Field label="ρ" value={rho1} onChange={withTouch(c1.touch, setRho1)} unit="Ω·cm" />
          <Button
            size="sm"
            onClick={() =>
              void c1.run("Resistivity / Sheet resistance", async () => {
                const r = await electricalSheetResistance(Number(rho1), Number(thick) * NM_TO_CM);
                return `Rs = ${fmtNum(r.Rs)} Ω/sq`;
              })
            }
          >
            ρ → Rs
          </Button>
        </div>
        {resultLine(c1.result)}
      </Card>

      <Card title="Conductivity">
        <div style={ROW}>
          <Field label="ρ" value={rho2} onChange={withTouch(c2.touch, setRho2)} unit="Ω·cm" />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void c2.run("Conductivity", async () => {
                const r = await electricalConductivity(Number(rho2));
                return `σ = ${fmtNum(r.sigma)} S/cm`;
              })
            }
          >
            =
          </Button>
        </div>
        {resultLine(c2.result)}
      </Card>

      <Card title="Mobility">
        <div style={ROW}>
          <Field label="ρ" value={rho3} onChange={withTouch(c3.touch, setRho3)} unit="Ω·cm" />
          <Field label="n" value={n3} onChange={withTouch(c3.touch, setN3)} unit="cm⁻³" />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void c3.run("Mobility", async () => {
                const r = await electricalMobility(Number(rho3), Number(n3));
                return `μ = ${fmtNum(r.mu)} cm²/(V·s)`;
              })
            }
          >
            =
          </Button>
        </div>
        {resultLine(c3.result)}
      </Card>

      <Card title="Current density">
        <div style={ROW}>
          <Field label="I" value={cur} onChange={withTouch(c4.touch, setCur)} unit="A" />
          <Field label="A" value={area} onChange={withTouch(c4.touch, setArea)} unit="cm²" />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void c4.run("Current density", async () => {
                const r = await electricalCurrentDensity(Number(cur), Number(area));
                return `J = ${fmtNum(r.J)} A/cm²`;
              })
            }
          >
            =
          </Button>
        </div>
        {resultLine(c4.result)}
      </Card>

      <Card title="Hall effect">
        <div style={ROW}>
          <Field label="V_H" value={vH} onChange={withTouch(c5.touch, setVH)} unit="V" width={72} />
          <Field label="I" value={hallI} onChange={withTouch(c5.touch, setHallI)} unit="A" width={72} />
        </div>
        <div style={{ ...ROW, marginTop: 8 }}>
          <Field label="B" value={hallB} onChange={withTouch(c5.touch, setHallB)} unit="T" width={72} />
          <Field
            label="t"
            value={hallT}
            onChange={withTouch(c5.touch, setHallT)}
            unit="nm"
            width={72}
            ariaLabel="Hall effect thickness"
          />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void c5.run("Hall effect", async () => {
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
        {resultLine(c5.result)}
      </Card>

      <Card title="Hall sweep (paste H, R_xy)">
        <div className="qzk-field-lbl" style={{ marginTop: 0, marginBottom: 4 }}>
          Paste field + Hall-resistance columns (one "H R_xy" pair per line —
          space, comma, or tab separated)
        </div>
        <textarea
          className="qz-input"
          style={{ width: "100%", minHeight: 80, fontFamily: "var(--font-mono)" }}
          value={hsText}
          onChange={(e) => {
            setHsText(e.target.value);
            c6.touch();
          }}
          placeholder={"-1, -0.002\n0, 0.0005\n1, 0.0025\n..."}
          aria-label="Hall sweep H, R_xy data"
        />
        <div style={{ ...ROW, marginTop: 8 }}>
          <Field
            label="t"
            value={hsT}
            onChange={withTouch(c6.touch, setHsT)}
            unit="nm (opt)"
            width={72}
            ariaLabel="Hall sweep thickness"
          />
          <Field
            label="σ"
            value={hsSigma}
            onChange={withTouch(c6.touch, setHsSigma)}
            unit="S/cm (opt)"
            width={80}
            ariaLabel="Hall sweep sigma"
          />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void c6.run("Hall sweep", async () => {
                const { x: field, y: hallResistance } = parseXYPairs(hsText);
                if (field.length < 2) throw new Error("paste at least 2 valid H, R_xy rows");
                const t = hsT.trim() === "" ? undefined : Number(hsT) * NM_TO_CM;
                const sigma = hsSigma.trim() === "" ? undefined : Number(hsSigma);
                const r = await electricalHallSweep({
                  field,
                  hall_resistance: hallResistance,
                  thickness: t,
                  sigma,
                });
                let s =
                  `R_H = ${fmtNum(r.r_h)} cm³/C · n = ${fmtNum(r.carrier_density)} cm⁻³ · ` +
                  `${r.carrier_type}-type · R² = ${fmtNum(r.fit_r2)}`;
                if (Number.isFinite(r.mobility)) s += ` · µ = ${fmtNum(r.mobility)} cm²/(V·s)`;
                return s;
              })
            }
          >
            Fit
          </Button>
        </div>
        {resultLine(c6.result)}
      </Card>

      <Card title="Van der Pauw">
        <div style={ROW}>
          <Field label="Ra" value={vdpRa} onChange={withTouch(c7.touch, setVdpRa)} unit="Ω" width={64} />
          <Field label="Rb" value={vdpRb} onChange={withTouch(c7.touch, setVdpRb)} unit="Ω" width={64} />
          <Field
            label="t"
            value={vdpT}
            onChange={withTouch(c7.touch, setVdpT)}
            unit="nm (opt)"
            width={72}
            ariaLabel="Van der Pauw thickness"
          />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void c7.run("Van der Pauw", async () => {
                const t = vdpT.trim() === "" ? undefined : Number(vdpT) * NM_TO_CM;
                const r = await electricalVanDerPauw(Number(vdpRa), Number(vdpRb), t);
                let s = `Rs = ${fmtNum(r.Rs)} Ω/sq`;
                if (r.rho != null) s += ` · ρ = ${fmtNum(r.rho)} Ω·cm`;
                return s;
              })
            }
          >
            Calculate
          </Button>
        </div>
        {resultLine(c7.result)}
      </Card>
    </div>
  );
}
