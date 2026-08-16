// Calculators ▸ Optics tab — Fresnel coefficients / critical + Brewster angles /
// penetration depth / skin depth / refractive-index ↔ dielectric (calc.optics,
// ports DiraCulator buildOpticsTab). Self-contained: owns its own local state
// so the shared useCalculators hook stays under the ceiling.

import { useState } from "react";

import {
  opticsBrewsterAngle,
  opticsCriticalAngle,
  opticsDielectricToRefractive,
  opticsFresnel,
  opticsPenetrationDepth,
  opticsRefractiveToDielectric,
  opticsSkinDepth,
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

export default function OpticsTab() {
  // Card 1 — Fresnel coefficients.
  const [fN1, setFN1] = useState("1.0");
  const [fN2, setFN2] = useState("1.5");
  const [fTh, setFTh] = useState("45");
  const c1 = useCard("Optics");

  // Card 2 — critical / Brewster angle.
  const [aN1, setAN1] = useState("1.5");
  const [aN2, setAN2] = useState("1.0");
  const c2 = useCard("Optics");

  // Card 3 — penetration depth.
  const [pN, setPN] = useState("1.0");
  const [pK, setPK] = useState("0.001");
  const [pLam, setPLam] = useState("1.5406");
  const c3 = useCard("Optics");

  // Card 4 — skin depth (rho in Ω·m, SI).
  const [sRho, setSRho] = useState("1.7e-8");
  const [sFreq, setSFreq] = useState("1e9");
  const c4 = useCard("Optics");

  // Card 5 — refractive index ↔ dielectric function.
  const [rdN, setRdN] = useState("3.5");
  const [rdK, setRdK] = useState("0.0");
  const [rdE1, setRdE1] = useState("12.25");
  const [rdE2, setRdE2] = useState("0.0");
  const c5 = useCard("Optics");

  return (
    <div style={{ marginTop: 12 }}>
      <Card title="Fresnel coefficients">
        <div style={ROW}>
          <Field label="n₁" value={fN1} onChange={withTouch(c1.touch, setFN1)} width={64} />
          <Field label="n₂" value={fN2} onChange={withTouch(c1.touch, setFN2)} width={64} />
          <Field label="θ" value={fTh} onChange={withTouch(c1.touch, setFTh)} unit="°" width={64} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void c1.run("Fresnel coefficients", async () => {
                const r = await opticsFresnel(Number(fN1), Number(fN2), Number(fTh));
                return `Rs = ${fmtNum(r.Rs)} · Rp = ${fmtNum(r.Rp)} · Ts = ${fmtNum(
                  r.Ts,
                )} · Tp = ${fmtNum(r.Tp)}`;
              })
            }
          >
            Calculate
          </Button>
        </div>
        {resultLine(c1.result)}
      </Card>

      <Card title="Critical / Brewster angle">
        <div style={ROW}>
          <Field label="n₁" value={aN1} onChange={withTouch(c2.touch, setAN1)} width={64} />
          <Field label="n₂" value={aN2} onChange={withTouch(c2.touch, setAN2)} width={64} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void c2.run("Critical / Brewster angle", async () => {
                const [rc, rb] = await Promise.all([
                  opticsCriticalAngle(Number(aN1), Number(aN2)),
                  opticsBrewsterAngle(Number(aN1), Number(aN2)),
                ]);
                const tc = Number.isNaN(rc.theta_c) ? "— (no TIR)" : `${fmtNum(rc.theta_c)}°`;
                return `θc = ${tc} · θB = ${fmtNum(rb.theta_b)}°`;
              })
            }
          >
            Calculate
          </Button>
        </div>
        {resultLine(c2.result)}
      </Card>

      <Card title="Penetration depth">
        <div style={ROW}>
          <Field label="n" value={pN} onChange={withTouch(c3.touch, setPN)} width={64} />
          <Field label="k" value={pK} onChange={withTouch(c3.touch, setPK)} width={64} />
          <Field label="λ" value={pLam} onChange={withTouch(c3.touch, setPLam)} width={72} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void c3.run("Penetration depth", async () => {
                const r = await opticsPenetrationDepth(Number(pN), Number(pK), Number(pLam));
                return `depth = ${fmtNum(r.depth)} (same unit as λ)`;
              })
            }
          >
            Calculate
          </Button>
        </div>
        {resultLine(c3.result)}
      </Card>

      <Card title="Skin depth">
        <div style={ROW}>
          <Field label="ρ" value={sRho} onChange={withTouch(c4.touch, setSRho)} unit="Ω·m" />
          <Field label="f" value={sFreq} onChange={withTouch(c4.touch, setSFreq)} unit="Hz" />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void c4.run("Skin depth", async () => {
                const r = await opticsSkinDepth(Number(sRho), Number(sFreq));
                return `δ = ${fmtNum(r.delta_um)} µm`;
              })
            }
          >
            Calculate
          </Button>
        </div>
        {resultLine(c4.result)}
      </Card>

      <Card title="Refractive index / Dielectric function">
        <div style={ROW}>
          <Field label="n" value={rdN} onChange={withTouch(c5.touch, setRdN)} width={64} />
          <Field label="k" value={rdK} onChange={withTouch(c5.touch, setRdK)} width={64} />
          <Button
            size="sm"
            onClick={() =>
              void c5.run("Refractive index / Dielectric function", async () => {
                const r = await opticsRefractiveToDielectric(Number(rdN), Number(rdK));
                setRdE1(String(r.eps1));
                setRdE2(String(r.eps2));
                return `ε₁ = ${fmtNum(r.eps1)} · ε₂ = ${fmtNum(r.eps2)}`;
              })
            }
          >
            n,k → ε
          </Button>
        </div>
        <div style={{ ...ROW, marginTop: 8 }}>
          <Field label="ε₁" value={rdE1} onChange={withTouch(c5.touch, setRdE1)} width={64} />
          <Field label="ε₂" value={rdE2} onChange={withTouch(c5.touch, setRdE2)} width={64} />
          <Button
            size="sm"
            onClick={() =>
              void c5.run("Refractive index / Dielectric function", async () => {
                const r = await opticsDielectricToRefractive(Number(rdE1), Number(rdE2));
                setRdN(String(r.n));
                setRdK(String(r.k));
                return `n = ${fmtNum(r.n)} · k = ${fmtNum(r.k)}`;
              })
            }
          >
            ε → n,k
          </Button>
        </div>
        {resultLine(c5.result)}
      </Card>
    </div>
  );
}
