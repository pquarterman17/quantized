// Calculators ▸ Superconductor tab — BCS gap / London penetration depth /
// coherence length / Ginzburg-Landau parameter / critical fields / depairing
// current (calc.superconductor, ports DiraCulator buildSuperconductorTab).
// Self-contained: owns its own local state so the shared useCalculators hook
// stays under the ceiling. Material presets are embedded locally for the
// dropdown auto-fill (the backend exposes them too via scMaterialPresets).

import { useState } from "react";

import {
  scBcsGap,
  scCoherenceLength,
  scCriticalFields,
  scDepairingCurrent,
  scGlParameter,
  scLondonDepth,
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

const run = makeCardRunner("Superconductor");

// lambda0 / xi0 in nm, Hc0 in Oe, Tc in K — port of materialPresets.m.
const PRESETS: Record<
  string,
  { Tc: number; lambda0: number; xi0: number; Hc0: number }
> = {
  Nb: { Tc: 9.25, lambda0: 39, xi0: 38, Hc0: 1980 },
  NbN: { Tc: 16.0, lambda0: 200, xi0: 5, Hc0: 80000 },
  YBCO: { Tc: 92, lambda0: 150, xi0: 1.5, Hc0: 0 },
  MgB2: { Tc: 39, lambda0: 140, xi0: 5, Hc0: 0 },
  Al: { Tc: 1.18, lambda0: 16, xi0: 1600, Hc0: 105 },
  Pb: { Tc: 7.19, lambda0: 37, xi0: 83, Hc0: 803 },
  In: { Tc: 3.41, lambda0: 24, xi0: 440, Hc0: 282 },
  Sn: { Tc: 3.72, lambda0: 34, xi0: 230, Hc0: 305 },
};
const MATERIALS = Object.keys(PRESETS);

const fmtOe = (v: number) => (Number.isNaN(v) ? "—" : `${fmtNum(v)} Oe`);

export default function SuperconductorTab() {
  // Card 1 — BCS gap.
  const [gTc, setGTc] = useState("9.25");
  const [gT, setGT] = useState("4.2");
  const [c1, setC1] = useState<CardResult>(null);

  // Card 2 — London penetration depth.
  const [lMat, setLMat] = useState("Nb");
  const [lLam0, setLLam0] = useState("39");
  const [lTc, setLTc] = useState("9.25");
  const [lT, setLT] = useState("4.2");
  const [c2, setC2] = useState<CardResult>(null);

  // Card 3 — coherence length.
  const [xMat, setXMat] = useState("Nb");
  const [xXi0, setXXi0] = useState("38");
  const [xTc, setXTc] = useState("9.25");
  const [xT, setXT] = useState("4.2");
  const [c3, setC3] = useState<CardResult>(null);

  // Card 4 — Ginzburg-Landau parameter.
  const [kLam, setKLam] = useState("39");
  const [kXi, setKXi] = useState("38");
  const [c4, setC4] = useState<CardResult>(null);

  // Card 5 — critical fields.
  const [hMat, setHMat] = useState("Nb");
  const [hHc0, setHHc0] = useState("1980");
  const [hTc, setHTc] = useState("9.25");
  const [hT, setHT] = useState("4.2");
  const [c5, setC5] = useState<CardResult>(null);

  // Card 6 — depairing current.
  const [dMat, setDMat] = useState("Nb");
  const [dHc0, setDHc0] = useState("1980");
  const [dLam0, setDLam0] = useState("39");
  const [dTc, setDTc] = useState("9.25");
  const [dT, setDT] = useState("4.2");
  const [c6, setC6] = useState<CardResult>(null);

  function MatSelect({
    value,
    onChange,
    fill,
  }: {
    value: string;
    onChange: (v: string) => void;
    fill: (p: (typeof PRESETS)[string]) => void;
  }) {
    return (
      <select
        className="qz-select"
        aria-label="material"
        value={value}
        onChange={(e) => {
          const m = e.target.value;
          onChange(m);
          if (PRESETS[m]) fill(PRESETS[m]);
        }}
      >
        {MATERIALS.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div style={{ marginTop: 12 }}>
      <Card title="BCS gap Δ₀ = 1.764·k_B·T_c">
        <div style={ROW}>
          <Field label="T_c" value={gTc} onChange={setGTc} unit="K" width={64} />
          <Field label="T" value={gT} onChange={setGT} unit="K" width={64} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC1, "BCS gap", async () => {
                const r = await scBcsGap(Number(gTc), Number(gT));
                return `Δ₀ = ${fmtNum(r.delta0)} meV · Δ(T) = ${fmtNum(
                  r.deltaT,
                )} meV · 2Δ₀/k_BT_c = ${fmtNum(r.ratio)}`;
              })
            }
          >
            Calculate
          </Button>
        </div>
        {resultLine(c1)}
      </Card>

      <Card title="London penetration depth">
        <div style={ROW}>
          <MatSelect
            value={lMat}
            onChange={setLMat}
            fill={(p) => {
              setLLam0(String(p.lambda0));
              setLTc(String(p.Tc));
            }}
          />
          <Field label="λ₀" value={lLam0} onChange={setLLam0} unit="nm" width={64} />
          <Field label="T_c" value={lTc} onChange={setLTc} unit="K" width={56} />
          <Field label="T" value={lT} onChange={setLT} unit="K" width={56} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC2, "London penetration depth", async () => {
                const r = await scLondonDepth(Number(lLam0), Number(lT), Number(lTc));
                return `λ(${fmtNum(r.T)} K) = ${fmtNum(r.lambda)} nm`;
              })
            }
          >
            Calculate
          </Button>
        </div>
        {resultLine(c2)}
      </Card>

      <Card title="Coherence length">
        <div style={ROW}>
          <MatSelect
            value={xMat}
            onChange={setXMat}
            fill={(p) => {
              setXXi0(String(p.xi0));
              setXTc(String(p.Tc));
            }}
          />
          <Field label="ξ₀" value={xXi0} onChange={setXXi0} unit="nm" width={64} />
          <Field label="T_c" value={xTc} onChange={setXTc} unit="K" width={56} />
          <Field label="T" value={xT} onChange={setXT} unit="K" width={56} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC3, "Coherence length", async () => {
                const r = await scCoherenceLength(Number(xXi0), Number(xT), Number(xTc));
                return `ξ(${fmtNum(r.T)} K) = ${fmtNum(r.xi)} nm`;
              })
            }
          >
            Calculate
          </Button>
        </div>
        {resultLine(c3)}
      </Card>

      <Card title="Ginzburg-Landau parameter κ = λ/ξ">
        <div style={ROW}>
          <Field label="λ" value={kLam} onChange={setKLam} unit="nm" width={64} />
          <Field label="ξ" value={kXi} onChange={setKXi} unit="nm" width={64} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC4, "Ginzburg-Landau parameter", async () => {
                const r = await scGlParameter(Number(kLam), Number(kXi));
                return `κ = ${fmtNum(r.kappa)} (Type ${r.type})`;
              })
            }
          >
            Calculate
          </Button>
        </div>
        {resultLine(c4)}
      </Card>

      <Card title="Critical fields">
        <div style={ROW}>
          <MatSelect
            value={hMat}
            onChange={setHMat}
            fill={(p) => {
              setHHc0(String(p.Hc0));
              setHTc(String(p.Tc));
            }}
          />
          <Field label="H_c0" value={hHc0} onChange={setHHc0} unit="Oe" width={72} />
          <Field label="T_c" value={hTc} onChange={setHTc} unit="K" width={56} />
          <Field label="T" value={hT} onChange={setHT} unit="K" width={56} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC5, "Critical fields", async () => {
                const r = await scCriticalFields(
                  Number(hHc0),
                  Number(hTc),
                  Number(hT),
                  hMat,
                );
                return `Type ${r.type} · H_c = ${fmtOe(r.Hc)} · H_c1 = ${fmtOe(
                  r.Hc1,
                )} · H_c2 = ${fmtOe(r.Hc2)}`;
              })
            }
          >
            Calculate
          </Button>
        </div>
        {resultLine(c5)}
      </Card>

      <Card title="Depairing current density">
        <div style={ROW}>
          <MatSelect
            value={dMat}
            onChange={setDMat}
            fill={(p) => {
              setDHc0(String(p.Hc0));
              setDLam0(String(p.lambda0));
              setDTc(String(p.Tc));
            }}
          />
          <Field label="H_c0" value={dHc0} onChange={setDHc0} unit="Oe" width={72} />
          <Field label="λ₀" value={dLam0} onChange={setDLam0} unit="nm" width={56} />
          <Field label="T_c" value={dTc} onChange={setDTc} unit="K" width={52} />
          <Field label="T" value={dT} onChange={setDT} unit="K" width={52} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC6, "Depairing current density", async () => {
                const r = await scDepairingCurrent(
                  Number(dHc0),
                  Number(dLam0),
                  Number(dTc),
                  Number(dT),
                );
                return `J_d = ${fmtNum(r.JdMA)} MA/cm²`;
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
