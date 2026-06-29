// Calculators ▸ Electrical tab — resistivity / sheet resistance / conductivity /
// mobility / current density / Hall effect (calc.electrical, golden vs MATLAB
// DiraCulator buildElectricalTab). Self-contained: owns its own local state so
// the shared useCalculators hook stays under the ceiling.

import { useState } from "react";

import { Button, NumberField } from "../../primitives";
import {
  electricalConductivity,
  electricalCurrentDensity,
  electricalHall,
  electricalMobility,
  electricalResistivity,
  electricalSheetResistance,
} from "../../../lib/api";
import { fmtNum } from "../../../lib/format";

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

const NM_TO_CM = 1e-7;

export default function ElectricalTab() {
  // Card 1 — resistivity / sheet resistance (t in nm, converted to cm).
  const [rs, setRs] = useState("100");
  const [thick, setThick] = useState("10");
  const [rho1, setRho1] = useState("1e-4");
  const [c1, setC1] = useState<{ text: string; err?: boolean } | null>(null);

  // Card 2 — conductivity.
  const [rho2, setRho2] = useState("1e-4");
  const [c2, setC2] = useState<{ text: string; err?: boolean } | null>(null);

  // Card 3 — mobility.
  const [rho3, setRho3] = useState("1e-2");
  const [n3, setN3] = useState("1e17");
  const [c3, setC3] = useState<{ text: string; err?: boolean } | null>(null);

  // Card 4 — current density.
  const [cur, setCur] = useState("1e-3");
  const [area, setArea] = useState("1");
  const [c4, setC4] = useState<{ text: string; err?: boolean } | null>(null);

  // Card 5 — Hall effect (t in nm).
  const [vH, setVH] = useState("1e-3");
  const [hallI, setHallI] = useState("1e-3");
  const [hallB, setHallB] = useState("1");
  const [hallT, setHallT] = useState("100");
  const [c5, setC5] = useState<{ text: string; err?: boolean } | null>(null);

  async function run(
    setter: (r: { text: string; err?: boolean } | null) => void,
    fn: () => Promise<string>,
  ): Promise<void> {
    try {
      setter({ text: await fn() });
    } catch (e) {
      setter({ text: e instanceof Error ? e.message : "calculation failed", err: true });
    }
  }

  const result = (r: { text: string; err?: boolean } | null) =>
    r && <div style={r.err ? ERR : RESULT}>{r.text}</div>;

  return (
    <div style={{ marginTop: 12 }}>
      <Card title="Resistivity / Sheet resistance">
        <div style={ROW}>
          <Field label="Rs" value={rs} onChange={setRs} unit="Ω/sq" />
          <Field label="t" value={thick} onChange={setThick} unit="nm" />
          <Button
            size="sm"
            onClick={() =>
              void run(setC1, async () => {
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
              void run(setC1, async () => {
                const r = await electricalSheetResistance(Number(rho1), Number(thick) * NM_TO_CM);
                return `Rs = ${fmtNum(r.Rs)} Ω/sq`;
              })
            }
          >
            ρ → Rs
          </Button>
        </div>
        {result(c1)}
      </Card>

      <Card title="Conductivity">
        <div style={ROW}>
          <Field label="ρ" value={rho2} onChange={setRho2} unit="Ω·cm" />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC2, async () => {
                const r = await electricalConductivity(Number(rho2));
                return `σ = ${fmtNum(r.sigma)} S/cm`;
              })
            }
          >
            =
          </Button>
        </div>
        {result(c2)}
      </Card>

      <Card title="Mobility">
        <div style={ROW}>
          <Field label="ρ" value={rho3} onChange={setRho3} unit="Ω·cm" />
          <Field label="n" value={n3} onChange={setN3} unit="cm⁻³" />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC3, async () => {
                const r = await electricalMobility(Number(rho3), Number(n3));
                return `μ = ${fmtNum(r.mu)} cm²/(V·s)`;
              })
            }
          >
            =
          </Button>
        </div>
        {result(c3)}
      </Card>

      <Card title="Current density">
        <div style={ROW}>
          <Field label="I" value={cur} onChange={setCur} unit="A" />
          <Field label="A" value={area} onChange={setArea} unit="cm²" />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC4, async () => {
                const r = await electricalCurrentDensity(Number(cur), Number(area));
                return `J = ${fmtNum(r.J)} A/cm²`;
              })
            }
          >
            =
          </Button>
        </div>
        {result(c4)}
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
              void run(setC5, async () => {
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
        {result(c5)}
      </Card>
    </div>
  );
}
