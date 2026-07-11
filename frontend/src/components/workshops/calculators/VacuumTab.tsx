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
  makeCardRunner,
  resultLine,
  type CardResult,
} from "./shared";

const run = makeCardRunner("Vacuum");

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
  const [c1, setC1] = useState<CardResult>(null);

  // Card 2 — monolayer formation time.
  const [monoP, setMonoP] = useState("1.33e-4");
  const [c2, setC2] = useState<CardResult>(null);

  // Card 3 — sputter yield (lookup).
  const [syMat, setSyMat] = useState("Si");
  const [syIon, setSyIon] = useState("Ar");
  const [syE, setSyE] = useState("500");
  const [c3, setC3] = useState<CardResult>(null);

  // Card 4 — pump-down estimate.
  const [pV, setPV] = useState("50");
  const [pS, setPS] = useState("100");
  const [pP0, setPP0] = useState("1e5");
  const [pPf, setPPf] = useState("1e-4");
  const [c4, setC4] = useState<CardResult>(null);

  // Card 5 — Knudsen number.
  const [knMfp, setKnMfp] = useState("1e-4");
  const [knL, setKnL] = useState("0.025");
  const [c5, setC5] = useState<CardResult>(null);

  // Card 6 — gas-flow conductance (tube).
  const [gfP1, setGfP1] = useState("1e-3");
  const [gfP2, setGfP2] = useState("1e-5");
  const [gfD, setGfD] = useState("0.025");
  const [gfL, setGfL] = useState("0.5");
  const [c6, setC6] = useState<CardResult>(null);

  return (
    <div style={{ marginTop: 12 }}>
      <Card title="Mean free path">
        <div style={ROW}>
          <Field label="P" value={mfpP} onChange={setMfpP} unit="Pa" width={72} />
          <Field label="T" value={mfpT} onChange={setMfpT} unit="K" width={64} />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span className="qzk-field-lbl" style={{ margin: 0 }}>
              Gas
            </span>
            <Select
              options={GAS_OPTIONS}
              value={mfpGas}
              onChange={(e) => setMfpGas(e.target.value)}
            />
          </span>
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC1, "Mean free path", async () => {
                const r = await vacuumMeanFreePath(Number(mfpP), Number(mfpT), Number(mfpGas));
                return `λ = ${fmtNum(r.mfp)} m (${fmtNum(r.mfpMm)} mm)`;
              })
            }
          >
            Calculate
          </Button>
        </div>
        {resultLine(c1)}
      </Card>

      <Card title="Monolayer formation time">
        <div style={ROW}>
          <Field label="P" value={monoP} onChange={setMonoP} unit="Pa" />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC2, "Monolayer formation time", async () => {
                const r = await vacuumMonolayerTime(Number(monoP));
                return `t_mono = ${fmtNum(r.tMono)} s`;
              })
            }
          >
            Calculate
          </Button>
        </div>
        {resultLine(c2)}
      </Card>

      <Card title="Sputter yield (lookup)">
        <div style={ROW}>
          <Field label="Target" value={syMat} onChange={setSyMat} numeric={false} width={72} />
          <Field label="Ion" value={syIon} onChange={setSyIon} numeric={false} width={56} />
          <Field label="E" value={syE} onChange={setSyE} unit="eV" width={72} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC3, "Sputter yield", async () => {
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
        {resultLine(c3)}
      </Card>

      <Card title="Pump-down estimate">
        <div style={ROW}>
          <Field label="V" value={pV} onChange={setPV} unit="L" width={64} />
          <Field label="S" value={pS} onChange={setPS} unit="L/s" width={64} />
        </div>
        <div style={{ ...ROW, marginTop: 8 }}>
          <Field label="P0" value={pP0} onChange={setPP0} unit="Pa" width={72} />
          <Field label="Pf" value={pPf} onChange={setPPf} unit="Pa" width={72} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC4, "Pump-down estimate", async () => {
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
        {resultLine(c4)}
      </Card>

      <Card title="Knudsen number">
        <div style={ROW}>
          <Field label="MFP" value={knMfp} onChange={setKnMfp} unit="m" width={72} />
          <Field label="L" value={knL} onChange={setKnL} unit="m" width={72} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC5, "Knudsen number", async () => {
                const r = await vacuumKnudsen(Number(knMfp), Number(knL));
                return `Kn = ${fmtNum(r.Kn)} [${r.regime} flow]`;
              })
            }
          >
            Calculate
          </Button>
        </div>
        {resultLine(c5)}
      </Card>

      <Card title="Gas-flow conductance (tube)">
        <div style={ROW}>
          <Field label="P1" value={gfP1} onChange={setGfP1} unit="Pa" width={72} />
          <Field label="P2" value={gfP2} onChange={setGfP2} unit="Pa" width={72} />
        </div>
        <div style={{ ...ROW, marginTop: 8 }}>
          <Field label="d" value={gfD} onChange={setGfD} unit="m" width={72} />
          <Field label="L" value={gfL} onChange={setGfL} unit="m" width={72} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC6, "Gas-flow conductance", async () => {
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
        {resultLine(c6)}
      </Card>
    </div>
  );
}
