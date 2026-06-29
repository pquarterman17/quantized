// Calculators ▸ Electrochemistry tab — Nernst potential / Butler-Volmer /
// Tafel slope / ohmic (iR) drop / double-layer capacitance (calc.electrochemistry,
// ported from DiraCulator buildElectrochemistryTab). Self-contained: owns its own
// local state so the shared useCalculators hook stays under the ceiling.

import { useState } from "react";

import { Button, NumberField } from "../../primitives";
import {
  electrochemButlerVolmer,
  electrochemDoubleLayer,
  electrochemNernst,
  electrochemOhmicDrop,
  electrochemTafel,
} from "../../../lib/api";
import { fmtNum } from "../../../lib/format";
import { useCalcHistory } from "../../../store/calcHistory";

const DOMAIN = "Electrochemistry";

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

export default function ElectrochemistryTab() {
  // Card 1 — Nernst potential.
  const [e0, setE0] = useState("0.77");
  const [nerN, setNerN] = useState("1");
  const [nerQ, setNerQ] = useState("0.01");
  const [c1, setC1] = useState<{ text: string; err?: boolean } | null>(null);

  // Card 2 — Butler-Volmer.
  const [j0, setJ0] = useState("1e-3");
  const [eta, setEta] = useState("0.1");
  const [bvAlpha, setBvAlpha] = useState("0.5");
  const [c2, setC2] = useState<{ text: string; err?: boolean } | null>(null);

  // Card 3 — Tafel slope.
  const [tafAlpha, setTafAlpha] = useState("0.5");
  const [tafT, setTafT] = useState("298.15");
  const [c3, setC3] = useState<{ text: string; err?: boolean } | null>(null);

  // Card 4 — Double-layer capacitance.
  const [eps, setEps] = useState("78");
  const [dlcD, setDlcD] = useState("0.5");
  const [dlcA, setDlcA] = useState("1");
  const [c4, setC4] = useState<{ text: string; err?: boolean } | null>(null);

  // Card 5 — Ohmic drop (iR).
  const [irI, setIrI] = useState("1e-3");
  const [irR, setIrR] = useState("50");
  const [c5, setC5] = useState<{ text: string; err?: boolean } | null>(null);

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
        {result(c1)}
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
        {result(c2)}
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
        {result(c3)}
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
        {result(c4)}
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
        {result(c5)}
      </Card>
    </div>
  );
}
