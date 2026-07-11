// Calculators ▸ Magnetic tab — moment conversions / demagnetizing factors /
// Curie-Weiss / Langevin / domain wall (calc.magnetic, ported from DiraCulator
// buildMagneticTab). Distinct from the magnetometry hysteresis analysis.
// Self-contained: owns its own local state so the shared useCalculators hook
// stays under the ceiling.

import { useState } from "react";

import {
  magneticCurieWeiss,
  magneticDemag,
  magneticDomainWall,
  magneticLangevin,
  magneticMomentConvert,
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

const run = makeCardRunner("Magnetic");

const MOMENT_UNITS = ["emu", "Am2", "memu", "uemu"];
const DEMAG_SHAPES = [
  "Sphere",
  "Thin film (in-plane)",
  "Thin film (out-of-plane)",
  "Long cylinder (axial)",
  "Long cylinder (transverse)",
];

export default function MagneticTab() {
  // Card 1 — moment conversions.
  const [momVal, setMomVal] = useState("1e-3");
  const [momUnit, setMomUnit] = useState("emu");
  const [momVol, setMomVol] = useState("0");
  const [momAtoms, setMomAtoms] = useState("0");
  const [c1, setC1] = useState<CardResult>(null);

  // Card 2 — demagnetizing factors.
  const [shape, setShape] = useState("Sphere");
  const [c2, setC2] = useState<CardResult>(null);

  // Card 3 — Curie-Weiss.
  const [cwC, setCwC] = useState("4.375");
  const [cwTheta, setCwTheta] = useState("-50");
  const [c3, setC3] = useState<CardResult>(null);

  // Card 4 — Langevin.
  const [langMu, setLangMu] = useState("1e-16");
  const [langH, setLangH] = useState("10000");
  const [langT, setLangT] = useState("300");
  const [c4, setC4] = useState<CardResult>(null);

  // Card 5 — domain wall.
  const [dwA, setDwA] = useState("2e-6");
  const [dwK, setDwK] = useState("4.8e6");
  const [c5, setC5] = useState<CardResult>(null);

  return (
    <div style={{ marginTop: 12 }}>
      <Card title="Moment conversions">
        <div style={ROW}>
          <Field label="m" value={momVal} onChange={setMomVal} width={90} />
          <select
            className="qz-select"
            value={momUnit}
            onChange={(e) => setMomUnit(e.target.value)}
            aria-label="moment unit"
          >
            {MOMENT_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
        <div style={{ ...ROW, marginTop: 8 }}>
          <Field label="V" value={momVol} onChange={setMomVol} unit="cm³" width={72} />
          <Field label="atoms" value={momAtoms} onChange={setMomAtoms} width={84} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC1, "Moment conversions", async () => {
                const vol = Number(momVol);
                const atoms = Number(momAtoms);
                const r = await magneticMomentConvert(
                  Number(momVal),
                  momUnit,
                  vol > 0 ? vol : undefined,
                  atoms > 0 ? atoms : undefined,
                );
                let s = `${fmtNum(r.emu)} emu = ${fmtNum(r.am2)} A·m² = ${fmtNum(r.mu_b)} µ_B`;
                if (r.m_si != null) s += ` · M = ${fmtNum(r.m_si)} A/m`;
                if (r.mu_b_per_atom != null) s += ` · ${fmtNum(r.mu_b_per_atom)} µ_B/atom`;
                return s;
              })
            }
          >
            Convert
          </Button>
        </div>
        {resultLine(c1)}
      </Card>

      <Card title="Demagnetization factors">
        <div style={ROW}>
          <select
            className="qz-select"
            value={shape}
            onChange={(e) => setShape(e.target.value)}
            aria-label="shape"
          >
            {DEMAG_SHAPES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC2, "Demagnetization factors", async () => {
                const r = await magneticDemag(shape);
                return `Nz = ${fmtNum(r.Nz)} · Nxy = ${fmtNum(r.Nxy)} · 4πNz = ${fmtNum(
                  r.n_cgs,
                )}`;
              })
            }
          >
            Calculate
          </Button>
        </div>
        {resultLine(c2)}
      </Card>

      <Card title="Curie-Weiss law">
        <div style={ROW}>
          <Field label="C" value={cwC} onChange={setCwC} unit="emu·K/mol" width={72} />
          <Field label="θ" value={cwTheta} onChange={setCwTheta} unit="K" width={72} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC3, "Curie-Weiss law", async () => {
                const r = await magneticCurieWeiss(Number(cwC), Number(cwTheta));
                return `µ_eff = ${fmtNum(r.mu_eff)} µ_B · ${r.mag_type}`;
              })
            }
          >
            Calculate
          </Button>
        </div>
        {resultLine(c3)}
      </Card>

      <Card title="Langevin / superparamagnetism">
        <div style={ROW}>
          <Field label="µ" value={langMu} onChange={setLangMu} unit="emu" width={72} />
          <Field label="H" value={langH} onChange={setLangH} unit="Oe" width={72} />
          <Field label="T" value={langT} onChange={setLangT} unit="K" width={64} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC4, "Langevin / superparamagnetism", async () => {
                const r = await magneticLangevin(Number(langMu), Number(langH), Number(langT));
                return `L(x) = ${fmtNum(r.L)} at x = ${fmtNum(r.x)}`;
              })
            }
          >
            Calculate
          </Button>
        </div>
        {resultLine(c4)}
      </Card>

      <Card title="Domain wall & anisotropy">
        <div style={ROW}>
          <Field label="A" value={dwA} onChange={setDwA} unit="erg/cm" width={72} />
          <Field label="K" value={dwK} onChange={setDwK} unit="erg/cm³" width={72} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC5, "Domain wall & anisotropy", async () => {
                const r = await magneticDomainWall(Number(dwA), Number(dwK));
                return `δ = ${fmtNum(r.delta_nm)} nm · E_wall = ${fmtNum(r.e_wall_mj_m2)} mJ/m²`;
              })
            }
          >
            Calculate
          </Button>
        </div>
        {resultLine(c5)}
      </Card>
    </div>
  );
}
