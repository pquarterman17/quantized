// Calculators ▸ Vacuum tab — mean free path / monolayer time / sputter yield /
// pump-down time / Knudsen number / gas-flow conductance (calc.vacuum, mirrors
// MATLAB DiraCulator buildVacuumTab). Self-contained: owns its own local state
// so the shared useCalculators hook stays under the ceiling.

import { useState } from "react";

import { Select } from "../../primitives";
import {
  vacuumGasFlow,
  vacuumKnudsen,
  vacuumMeanFreePath,
  vacuumMonolayerTime,
  vacuumPumpDownTime,
  vacuumSputterYield,
} from "../../../lib/api";
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

// Molecular diameter (m) per gas species — sets d in λ = kT/(√2 π d² P).
const GAS_OPTIONS = [
  { value: "3.64e-10", label: "N2 (air)" },
  { value: "2.60e-10", label: "He" },
  { value: "3.40e-10", label: "Ar" },
  { value: "2.89e-10", label: "H2" },
  { value: "3.46e-10", label: "O2" },
  { value: "4.32e-10", label: "Xe" },
  { value: "3.60e-10", label: "Kr" },
];

export default function VacuumTab() {
  // Card 1 — mean free path.
  const [mfpP, setMfpP] = useState("1e-4");
  const [mfpT, setMfpT] = useState("300");
  const [mfpGas, setMfpGas] = useState("3.64e-10");
  const c1 = useCard("Vacuum");

  // Card 2 — monolayer formation time.
  const [monoP, setMonoP] = useState("1.33e-4");
  const c2 = useCard("Vacuum");

  // Card 3 — sputter yield (lookup).
  const [syMat, setSyMat] = useState("Si");
  const [syIon, setSyIon] = useState("Ar");
  const [syE, setSyE] = useState("500");
  const c3 = useCard("Vacuum");

  // Card 4 — pump-down estimate.
  const [pV, setPV] = useState("50");
  const [pS, setPS] = useState("100");
  const [pP0, setPP0] = useState("1e5");
  const [pPf, setPPf] = useState("1e-4");
  const c4 = useCard("Vacuum");

  // Card 5 — Knudsen number.
  const [knMfp, setKnMfp] = useState("1e-4");
  const [knL, setKnL] = useState("0.025");
  const c5 = useCard("Vacuum");

  // Card 6 — gas-flow conductance (tube).
  const [gfP1, setGfP1] = useState("1e-3");
  const [gfP2, setGfP2] = useState("1e-5");
  const [gfD, setGfD] = useState("0.025");
  const [gfL, setGfL] = useState("0.5");
  const c6 = useCard("Vacuum");

  return (
    <div style={{ marginTop: 12 }}>
      <Card title="Mean free path">
        <div style={ROW}>
          <Field label="P" value={mfpP} onChange={withTouch(c1.touch, setMfpP)} unit="Pa" width={72} />
          <Field label="T" value={mfpT} onChange={withTouch(c1.touch, setMfpT)} unit="K" width={64} />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span className="qzk-field-lbl" style={{ margin: 0 }}>
              Gas
            </span>
            <Select
              options={GAS_OPTIONS}
              value={mfpGas}
              onChange={(e) => {
                setMfpGas(e.target.value);
                c1.touch();
              }}
            />
          </span>
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void c1.run("Mean free path", async () => {
                const r = await vacuumMeanFreePath(Number(mfpP), Number(mfpT), Number(mfpGas));
                return `λ = ${fmtNum(r.mfp)} m (${fmtNum(r.mfpMm)} mm)`;
              })
            }
          >
            Calculate
          </Button>
        </div>
        {resultLine(c1.result)}
      </Card>

      <Card title="Monolayer formation time">
        <div style={ROW}>
          <Field label="P" value={monoP} onChange={withTouch(c2.touch, setMonoP)} unit="Pa" />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void c2.run("Monolayer formation time", async () => {
                const r = await vacuumMonolayerTime(Number(monoP));
                return `t_mono = ${fmtNum(r.tMono)} s`;
              })
            }
          >
            Calculate
          </Button>
        </div>
        {resultLine(c2.result)}
      </Card>

      <Card title="Sputter yield (lookup)">
        <div style={ROW}>
          <Field label="Target" value={syMat} onChange={withTouch(c3.touch, setSyMat)} numeric={false} width={72} />
          <Field label="Ion" value={syIon} onChange={withTouch(c3.touch, setSyIon)} numeric={false} width={56} />
          <Field label="E" value={syE} onChange={withTouch(c3.touch, setSyE)} unit="eV" width={72} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void c3.run("Sputter yield", async () => {
                const r = await vacuumSputterYield(syMat, Number(syE), syIon);
                return Number.isNaN(r.Y)
                  ? `Y(${syMat}/${syIon}) = N/A (out of table)`
                  : `Y(${syMat}/${syIon}, ${fmtNum(Number(syE))} eV) = ${fmtNum(r.Y)} atoms/ion`;
              })
            }
          >
            Calculate
          </Button>
        </div>
        {resultLine(c3.result)}
      </Card>

      <Card title="Pump-down estimate">
        <div style={ROW}>
          <Field label="V" value={pV} onChange={withTouch(c4.touch, setPV)} unit="L" width={64} />
          <Field label="S" value={pS} onChange={withTouch(c4.touch, setPS)} unit="L/s" width={64} />
        </div>
        <div style={{ ...ROW, marginTop: 8 }}>
          <Field label="P0" value={pP0} onChange={withTouch(c4.touch, setPP0)} unit="Pa" width={72} />
          <Field label="Pf" value={pPf} onChange={withTouch(c4.touch, setPPf)} unit="Pa" width={72} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void c4.run("Pump-down estimate", async () => {
                const r = await vacuumPumpDownTime(
                  Number(pV),
                  Number(pS),
                  Number(pP0),
                  Number(pPf),
                );
                return `t = ${fmtNum(r.time)} s (${fmtNum(r.timeMin)} min) · τ = ${fmtNum(r.tau)} s`;
              })
            }
          >
            Calculate
          </Button>
        </div>
        {resultLine(c4.result)}
      </Card>

      <Card title="Knudsen number">
        <div style={ROW}>
          <Field label="MFP" value={knMfp} onChange={withTouch(c5.touch, setKnMfp)} unit="m" width={72} />
          <Field label="L" value={knL} onChange={withTouch(c5.touch, setKnL)} unit="m" width={72} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void c5.run("Knudsen number", async () => {
                const r = await vacuumKnudsen(Number(knMfp), Number(knL));
                return `Kn = ${fmtNum(r.Kn)} [${r.regime} flow]`;
              })
            }
          >
            Calculate
          </Button>
        </div>
        {resultLine(c5.result)}
      </Card>

      <Card title="Gas-flow conductance (tube)">
        <div style={ROW}>
          <Field label="P1" value={gfP1} onChange={withTouch(c6.touch, setGfP1)} unit="Pa" width={72} />
          <Field label="P2" value={gfP2} onChange={withTouch(c6.touch, setGfP2)} unit="Pa" width={72} />
        </div>
        <div style={{ ...ROW, marginTop: 8 }}>
          <Field label="d" value={gfD} onChange={withTouch(c6.touch, setGfD)} unit="m" width={72} />
          <Field label="L" value={gfL} onChange={withTouch(c6.touch, setGfL)} unit="m" width={72} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void c6.run("Gas-flow conductance", async () => {
                const r = await vacuumGasFlow(
                  Number(gfP1),
                  Number(gfP2),
                  Number(gfD),
                  Number(gfL),
                );
                return `C_mol = ${fmtNum(r.Cmol)} L/s · C_visc = ${fmtNum(
                  r.Cvisc,
                )} L/s [${r.regime}]`;
              })
            }
          >
            Calculate
          </Button>
        </div>
        {resultLine(c6.result)}
      </Card>
    </div>
  );
}
