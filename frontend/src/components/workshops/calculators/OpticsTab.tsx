// Calculators ▸ Optics tab — Fresnel coefficients / critical + Brewster angles /
// penetration depth / skin depth / refractive-index ↔ dielectric (calc.optics,
// ports DiraCulator buildOpticsTab). Self-contained: owns its own local state
// so the shared useCalculators hook stays under the ceiling.

import { useState } from "react";

import { Button, NumberField } from "../../primitives";
import {
  opticsBrewsterAngle,
  opticsCriticalAngle,
  opticsDielectricToRefractive,
  opticsFresnel,
  opticsPenetrationDepth,
  opticsRefractiveToDielectric,
  opticsSkinDepth,
} from "../../../lib/api";
import { fmtNum } from "../../../lib/format";
import { useCalcHistory } from "../../../store/calcHistory";

const DOMAIN = "Optics";

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

export default function OpticsTab() {
  // Card 1 — Fresnel coefficients.
  const [fN1, setFN1] = useState("1.0");
  const [fN2, setFN2] = useState("1.5");
  const [fTh, setFTh] = useState("45");
  const [c1, setC1] = useState<{ text: string; err?: boolean } | null>(null);

  // Card 2 — critical / Brewster angle.
  const [aN1, setAN1] = useState("1.5");
  const [aN2, setAN2] = useState("1.0");
  const [c2, setC2] = useState<{ text: string; err?: boolean } | null>(null);

  // Card 3 — penetration depth.
  const [pN, setPN] = useState("1.0");
  const [pK, setPK] = useState("0.001");
  const [pLam, setPLam] = useState("1.5406");
  const [c3, setC3] = useState<{ text: string; err?: boolean } | null>(null);

  // Card 4 — skin depth (rho in Ω·m, SI).
  const [sRho, setSRho] = useState("1.7e-8");
  const [sFreq, setSFreq] = useState("1e9");
  const [c4, setC4] = useState<{ text: string; err?: boolean } | null>(null);

  // Card 5 — refractive index ↔ dielectric function.
  const [rdN, setRdN] = useState("3.5");
  const [rdK, setRdK] = useState("0.0");
  const [rdE1, setRdE1] = useState("12.25");
  const [rdE2, setRdE2] = useState("0.0");
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
      <Card title="Fresnel coefficients">
        <div style={ROW}>
          <Field label="n₁" value={fN1} onChange={setFN1} width={64} />
          <Field label="n₂" value={fN2} onChange={setFN2} width={64} />
          <Field label="θ" value={fTh} onChange={setFTh} unit="°" width={64} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC1, "Fresnel coefficients", async () => {
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
        {result(c1)}
      </Card>

      <Card title="Critical / Brewster angle">
        <div style={ROW}>
          <Field label="n₁" value={aN1} onChange={setAN1} width={64} />
          <Field label="n₂" value={aN2} onChange={setAN2} width={64} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC2, "Critical / Brewster angle", async () => {
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
        {result(c2)}
      </Card>

      <Card title="Penetration depth">
        <div style={ROW}>
          <Field label="n" value={pN} onChange={setPN} width={64} />
          <Field label="k" value={pK} onChange={setPK} width={64} />
          <Field label="λ" value={pLam} onChange={setPLam} width={72} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC3, "Penetration depth", async () => {
                const r = await opticsPenetrationDepth(Number(pN), Number(pK), Number(pLam));
                return `depth = ${fmtNum(r.depth)} (same unit as λ)`;
              })
            }
          >
            Calculate
          </Button>
        </div>
        {result(c3)}
      </Card>

      <Card title="Skin depth">
        <div style={ROW}>
          <Field label="ρ" value={sRho} onChange={setSRho} unit="Ω·m" />
          <Field label="f" value={sFreq} onChange={setSFreq} unit="Hz" />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC4, "Skin depth", async () => {
                const r = await opticsSkinDepth(Number(sRho), Number(sFreq));
                return `δ = ${fmtNum(r.delta_um)} µm`;
              })
            }
          >
            Calculate
          </Button>
        </div>
        {result(c4)}
      </Card>

      <Card title="Refractive index / Dielectric function">
        <div style={ROW}>
          <Field label="n" value={rdN} onChange={setRdN} width={64} />
          <Field label="k" value={rdK} onChange={setRdK} width={64} />
          <Button
            size="sm"
            onClick={() =>
              void run(setC5, "Refractive index / Dielectric function", async () => {
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
          <Field label="ε₁" value={rdE1} onChange={setRdE1} width={64} />
          <Field label="ε₂" value={rdE2} onChange={setRdE2} width={64} />
          <Button
            size="sm"
            onClick={() =>
              void run(setC5, "Refractive index / Dielectric function", async () => {
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
        {result(c5)}
      </Card>
    </div>
  );
}
