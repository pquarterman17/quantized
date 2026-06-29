// Calculators ▸ Diffusion tab — Arrhenius diffusion coefficient / diffusion
// length / Fick's first-law flux (calc.diffusion, ported from MATLAB
// DiraCulator buildDiffusionTab). Self-contained: owns its own local state so
// the shared useCalculators hook stays under the ceiling.

import { useState } from "react";

import { Button, NumberField } from "../../primitives";
import {
  diffusionArrhenius,
  diffusionFickFlux,
  diffusionLength,
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

export default function DiffusionTab() {
  // Card 1 — Arrhenius diffusion coefficient.
  const [d0, setD0] = useState("0.1");
  const [ea, setEa] = useState("1.0");
  const [arrT, setArrT] = useState("1000");
  const [c1, setC1] = useState<{ text: string; err?: boolean } | null>(null);

  // Card 2 — diffusion length.
  const [dlD, setDlD] = useState("1e-12");
  const [dlT, setDlT] = useState("3600");
  const [c2, setC2] = useState<{ text: string; err?: boolean } | null>(null);

  // Card 3 — Fick's first law (flux).
  const [fickD, setFickD] = useState("1e-12");
  const [fickDC, setFickDC] = useState("1e18");
  const [fickDx, setFickDx] = useState("1e-5");
  const [c3, setC3] = useState<{ text: string; err?: boolean } | null>(null);

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
      <Card title="Arrhenius diffusion coefficient">
        <div style={ROW}>
          <Field label="D₀" value={d0} onChange={setD0} unit="cm²/s" width={72} />
          <Field label="Eₐ" value={ea} onChange={setEa} unit="eV" width={72} />
          <Field label="T" value={arrT} onChange={setArrT} unit="K" width={72} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC1, async () => {
                const r = await diffusionArrhenius(Number(d0), Number(ea), Number(arrT));
                return `D = ${fmtNum(r.D)} cm²/s`;
              })
            }
          >
            =
          </Button>
        </div>
        {result(c1)}
      </Card>

      <Card title="Diffusion length">
        <div style={ROW}>
          <Field label="D" value={dlD} onChange={setDlD} unit="cm²/s" />
          <Field label="t" value={dlT} onChange={setDlT} unit="s" />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC2, async () => {
                const r = await diffusionLength(Number(dlD), Number(dlT));
                return `L = √(Dt) = ${fmtNum(r.L)} cm = ${fmtNum(r.L_um)} µm`;
              })
            }
          >
            =
          </Button>
        </div>
        {result(c2)}
      </Card>

      <Card title="Fick's first law (flux)">
        <div style={ROW}>
          <Field label="D" value={fickD} onChange={setFickD} unit="cm²/s" width={72} />
          <Field label="ΔC" value={fickDC} onChange={setFickDC} unit="cm⁻³" width={72} />
          <Field label="Δx" value={fickDx} onChange={setFickDx} unit="cm" width={72} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC3, async () => {
                const r = await diffusionFickFlux(Number(fickD), Number(fickDC), Number(fickDx));
                return `J = -D ∂C/∂x = ${fmtNum(r.J)} atoms/(cm²·s)`;
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
