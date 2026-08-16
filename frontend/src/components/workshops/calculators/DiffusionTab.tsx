// Calculators ▸ Diffusion tab — Arrhenius diffusion coefficient / diffusion
// length / Fick's first-law flux (calc.diffusion, ported from MATLAB
// DiraCulator buildDiffusionTab). Self-contained: owns its own local state so
// the shared useCalculators hook stays under the ceiling.

import { useState } from "react";

import {
  diffusionArrhenius,
  diffusionFickFlux,
  diffusionLength,
} from "../../../lib/api";
import { diffusionCProfile } from "../../../lib/api/diffusion";
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

export default function DiffusionTab() {
  // Card 1 — Arrhenius diffusion coefficient.
  const [d0, setD0] = useState("0.1");
  const [ea, setEa] = useState("1.0");
  const [arrT, setArrT] = useState("1000");
  const c1 = useCard("Diffusion");

  // Card 2 — diffusion length.
  const [dlD, setDlD] = useState("1e-12");
  const [dlT, setDlT] = useState("3600");
  const c2 = useCard("Diffusion");

  // Card 3 — Fick's first law (flux).
  const [fickD, setFickD] = useState("1e-12");
  const [fickDC, setFickDC] = useState("1e18");
  const [fickDx, setFickDx] = useState("1e-5");
  const c3 = useCard("Diffusion");

  // Card 4 — constant-source (erfc) diffusion profile.
  const [cpX, setCpX] = useState("3e-5");
  const [cpT, setCpT] = useState("3600");
  const [cpD, setCpD] = useState("1e-12");
  const [cpC0, setCpC0] = useState("1e18");
  const c4 = useCard("Diffusion");

  return (
    <div style={{ marginTop: 12 }}>
      <Card title="Arrhenius diffusion coefficient">
        <div style={ROW}>
          <Field label="D₀" value={d0} onChange={withTouch(c1.touch, setD0)} unit="cm²/s" width={72} />
          <Field label="Eₐ" value={ea} onChange={withTouch(c1.touch, setEa)} unit="eV" width={72} />
          <Field label="T" value={arrT} onChange={withTouch(c1.touch, setArrT)} unit="K" width={72} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void c1.run("Arrhenius diffusion coefficient", async () => {
                const r = await diffusionArrhenius(Number(d0), Number(ea), Number(arrT));
                return `D = ${fmtNum(r.D)} cm²/s`;
              })
            }
          >
            =
          </Button>
        </div>
        {resultLine(c1.result)}
      </Card>

      <Card title="Diffusion length">
        <div style={ROW}>
          <Field label="D" value={dlD} onChange={withTouch(c2.touch, setDlD)} unit="cm²/s" />
          <Field label="t" value={dlT} onChange={withTouch(c2.touch, setDlT)} unit="s" />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void c2.run("Diffusion length", async () => {
                const r = await diffusionLength(Number(dlD), Number(dlT));
                return `L = √(Dt) = ${fmtNum(r.L)} cm = ${fmtNum(r.L_um)} µm`;
              })
            }
          >
            =
          </Button>
        </div>
        {resultLine(c2.result)}
      </Card>

      <Card title="Fick's first law (flux)">
        <div style={ROW}>
          <Field label="D" value={fickD} onChange={withTouch(c3.touch, setFickD)} unit="cm²/s" width={72} />
          <Field label="ΔC" value={fickDC} onChange={withTouch(c3.touch, setFickDC)} unit="cm⁻³" width={72} />
          <Field label="Δx" value={fickDx} onChange={withTouch(c3.touch, setFickDx)} unit="cm" width={72} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void c3.run("Fick's first law (flux)", async () => {
                const r = await diffusionFickFlux(Number(fickD), Number(fickDC), Number(fickDx));
                return `J = -D ∂C/∂x = ${fmtNum(r.J)} atoms/(cm²·s)`;
              })
            }
          >
            =
          </Button>
        </div>
        {resultLine(c3.result)}
      </Card>

      <Card title="Constant-source diffusion profile (erfc)">
        <div style={ROW}>
          <Field label="x" value={cpX} onChange={withTouch(c4.touch, setCpX)} unit="cm" width={72} />
          <Field label="t" value={cpT} onChange={withTouch(c4.touch, setCpT)} unit="s" width={72} />
          <Field label="D" value={cpD} onChange={withTouch(c4.touch, setCpD)} unit="cm²/s" width={72} />
          <Field label="c₀" value={cpC0} onChange={withTouch(c4.touch, setCpC0)} width={72} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void c4.run("Constant-source diffusion profile", async () => {
                const r = await diffusionCProfile(
                  Number(cpX),
                  Number(cpT),
                  Number(cpD),
                  Number(cpC0),
                );
                const c = typeof r.c === "number" ? r.c : r.c[0];
                return `c(x,t) = ${fmtNum(c)} · L = √(Dt) = ${fmtNum(r.L)} cm`;
              })
            }
          >
            =
          </Button>
        </div>
        {resultLine(c4.result)}
      </Card>
    </div>
  );
}
