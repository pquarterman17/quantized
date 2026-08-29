// Calculators ▸ Electrochemistry tab — Nernst potential / Butler-Volmer /
// Tafel slope / ohmic (iR) drop / double-layer capacitance (calc.electrochemistry,
// ported from DiraCulator buildElectrochemistryTab). Self-contained: owns its own
// local state so the shared useCalculators hook stays under the ceiling.

import { useState } from "react";

import { electrochemButlerVolmer, electrochemDoubleLayer, electrochemNernst, electrochemOhmicDrop, electrochemTafel } from "../../../lib/api/electrochemistry";
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

export default function ElectrochemistryTab() {
  // Card 1 — Nernst potential.
  const [e0, setE0] = useState("0.77");
  const [nerN, setNerN] = useState("1");
  const [nerQ, setNerQ] = useState("0.01");
  const c1 = useCard("Electrochemistry");

  // Card 2 — Butler-Volmer.
  const [j0, setJ0] = useState("1e-3");
  const [eta, setEta] = useState("0.1");
  const [bvAlpha, setBvAlpha] = useState("0.5");
  const c2 = useCard("Electrochemistry");

  // Card 3 — Tafel slope.
  const [tafAlpha, setTafAlpha] = useState("0.5");
  const [tafT, setTafT] = useState("298.15");
  const c3 = useCard("Electrochemistry");

  // Card 4 — Double-layer capacitance.
  const [eps, setEps] = useState("78");
  const [dlcD, setDlcD] = useState("0.5");
  const [dlcA, setDlcA] = useState("1");
  const c4 = useCard("Electrochemistry");

  // Card 5 — Ohmic drop (iR).
  const [irI, setIrI] = useState("1e-3");
  const [irR, setIrR] = useState("50");
  const c5 = useCard("Electrochemistry");

  return (
    <div style={{ marginTop: 12 }}>
      <Card title="Nernst potential">
        <div style={ROW}>
          <Field label="E⁰" value={e0} onChange={withTouch(c1.touch, setE0)} unit="V" width={72} />
          <Field label="n" value={nerN} onChange={withTouch(c1.touch, setNerN)} width={56} />
          <Field label="Q" value={nerQ} onChange={withTouch(c1.touch, setNerQ)} width={72} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void c1.run("Nernst potential", `E⁰=${e0} V, n=${nerN}, Q=${nerQ}`, async () => {
                const r = await electrochemNernst(Number(e0), Number(nerN), Number(nerQ));
                return `E = ${fmtNum(r.E)} V`;
              })
            }
          >
            =
          </Button>
        </div>
        {resultLine(c1.result)}
      </Card>

      <Card title="Butler-Volmer">
        <div style={ROW}>
          <Field label="j₀" value={j0} onChange={withTouch(c2.touch, setJ0)} unit="A/cm²" width={72} />
          <Field label="η" value={eta} onChange={withTouch(c2.touch, setEta)} unit="V" width={72} />
          <Field label="α" value={bvAlpha} onChange={withTouch(c2.touch, setBvAlpha)} width={56} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void c2.run("Butler-Volmer", `j₀=${j0} A/cm², η=${eta} V, α=${bvAlpha}`, async () => {
                const r = await electrochemButlerVolmer(
                  Number(j0),
                  Number(eta),
                  Number(bvAlpha),
                );
                return `j = ${fmtNum(r.j)} A/cm²`;
              })
            }
          >
            =
          </Button>
        </div>
        {resultLine(c2.result)}
      </Card>

      <Card title="Tafel slope">
        <div style={ROW}>
          <Field label="α" value={tafAlpha} onChange={withTouch(c3.touch, setTafAlpha)} width={56} />
          <Field label="T" value={tafT} onChange={withTouch(c3.touch, setTafT)} unit="K" width={72} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void c3.run("Tafel slope", `α=${tafAlpha}, T=${tafT} K`, async () => {
                const r = await electrochemTafel(Number(tafAlpha), Number(tafT));
                return `b = ${fmtNum(r.bMv)} mV/decade`;
              })
            }
          >
            =
          </Button>
        </div>
        {resultLine(c3.result)}
      </Card>

      <Card title="Double-layer capacitance">
        <div style={ROW}>
          <Field label="ε_r" value={eps} onChange={withTouch(c4.touch, setEps)} width={56} />
          <Field label="d" value={dlcD} onChange={withTouch(c4.touch, setDlcD)} unit="nm" width={64} />
          <Field label="A" value={dlcA} onChange={withTouch(c4.touch, setDlcA)} unit="cm²" width={64} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void c4.run("Double-layer capacitance", `εr=${eps}, d=${dlcD} nm, A=${dlcA} cm²`, async () => {
                const r = await electrochemDoubleLayer(Number(eps), Number(dlcD), Number(dlcA));
                return `C = ${fmtNum(r.CuF)} µF · ${fmtNum(r.Cspec * 1e6)} µF/cm²`;
              })
            }
          >
            =
          </Button>
        </div>
        {resultLine(c4.result)}
      </Card>

      <Card title="Ohmic drop (iR)">
        <div style={ROW}>
          <Field label="I" value={irI} onChange={withTouch(c5.touch, setIrI)} unit="A" width={72} />
          <Field label="R" value={irR} onChange={withTouch(c5.touch, setIrR)} unit="Ω" width={72} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void c5.run("Ohmic drop (iR)", `I=${irI} A, R=${irR} Ω`, async () => {
                const r = await electrochemOhmicDrop(Number(irI), Number(irR));
                return `V_IR = ${fmtNum(r.VmV)} mV (${fmtNum(r.V)} V)`;
              })
            }
          >
            =
          </Button>
        </div>
        {resultLine(c5.result)}
      </Card>
    </div>
  );
}
