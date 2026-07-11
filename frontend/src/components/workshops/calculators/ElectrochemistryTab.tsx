// Calculators ▸ Electrochemistry tab — Nernst potential / Butler-Volmer /
// Tafel slope / ohmic (iR) drop / double-layer capacitance (calc.electrochemistry,
// ported from DiraCulator buildElectrochemistryTab). Self-contained: owns its own
// local state so the shared useCalculators hook stays under the ceiling.

import { useState } from "react";

import {
  electrochemButlerVolmer,
  electrochemDoubleLayer,
  electrochemNernst,
  electrochemOhmicDrop,
  electrochemTafel,
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

const run = makeCardRunner("Electrochemistry");

export default function ElectrochemistryTab() {
  // Card 1 — Nernst potential.
  const [e0, setE0] = useState("0.77");
  const [nerN, setNerN] = useState("1");
  const [nerQ, setNerQ] = useState("0.01");
  const [c1, setC1] = useState<CardResult>(null);

  // Card 2 — Butler-Volmer.
  const [j0, setJ0] = useState("1e-3");
  const [eta, setEta] = useState("0.1");
  const [bvAlpha, setBvAlpha] = useState("0.5");
  const [c2, setC2] = useState<CardResult>(null);

  // Card 3 — Tafel slope.
  const [tafAlpha, setTafAlpha] = useState("0.5");
  const [tafT, setTafT] = useState("298.15");
  const [c3, setC3] = useState<CardResult>(null);

  // Card 4 — Double-layer capacitance.
  const [eps, setEps] = useState("78");
  const [dlcD, setDlcD] = useState("0.5");
  const [dlcA, setDlcA] = useState("1");
  const [c4, setC4] = useState<CardResult>(null);

  // Card 5 — Ohmic drop (iR).
  const [irI, setIrI] = useState("1e-3");
  const [irR, setIrR] = useState("50");
  const [c5, setC5] = useState<CardResult>(null);

  return (
    <div style={{ marginTop: 12 }}>
      <Card title="Nernst potential">
        <div style={ROW}>
          <Field label="E⁰" value={e0} onChange={setE0} unit="V" width={72} />
          <Field label="n" value={nerN} onChange={setNerN} width={56} />
          <Field label="Q" value={nerQ} onChange={setNerQ} width={72} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC1, "Nernst potential", async () => {
                const r = await electrochemNernst(Number(e0), Number(nerN), Number(nerQ));
                return `E = ${fmtNum(r.E)} V`;
              })
            }
          >
            =
          </Button>
        </div>
        {resultLine(c1)}
      </Card>

      <Card title="Butler-Volmer">
        <div style={ROW}>
          <Field label="j₀" value={j0} onChange={setJ0} unit="A/cm²" width={72} />
          <Field label="η" value={eta} onChange={setEta} unit="V" width={72} />
          <Field label="α" value={bvAlpha} onChange={setBvAlpha} width={56} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC2, "Butler-Volmer", async () => {
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
        {resultLine(c2)}
      </Card>

      <Card title="Tafel slope">
        <div style={ROW}>
          <Field label="α" value={tafAlpha} onChange={setTafAlpha} width={56} />
          <Field label="T" value={tafT} onChange={setTafT} unit="K" width={72} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC3, "Tafel slope", async () => {
                const r = await electrochemTafel(Number(tafAlpha), Number(tafT));
                return `b = ${fmtNum(r.bMv)} mV/decade`;
              })
            }
          >
            =
          </Button>
        </div>
        {resultLine(c3)}
      </Card>

      <Card title="Double-layer capacitance">
        <div style={ROW}>
          <Field label="ε_r" value={eps} onChange={setEps} width={56} />
          <Field label="d" value={dlcD} onChange={setDlcD} unit="nm" width={64} />
          <Field label="A" value={dlcA} onChange={setDlcA} unit="cm²" width={64} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC4, "Double-layer capacitance", async () => {
                const r = await electrochemDoubleLayer(Number(eps), Number(dlcD), Number(dlcA));
                return `C = ${fmtNum(r.CuF)} µF · ${fmtNum(r.Cspec * 1e6)} µF/cm²`;
              })
            }
          >
            =
          </Button>
        </div>
        {resultLine(c4)}
      </Card>

      <Card title="Ohmic drop (iR)">
        <div style={ROW}>
          <Field label="I" value={irI} onChange={setIrI} unit="A" width={72} />
          <Field label="R" value={irR} onChange={setIrR} unit="Ω" width={72} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC5, "Ohmic drop (iR)", async () => {
                const r = await electrochemOhmicDrop(Number(irI), Number(irR));
                return `V_IR = ${fmtNum(r.VmV)} mV (${fmtNum(r.V)} V)`;
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
