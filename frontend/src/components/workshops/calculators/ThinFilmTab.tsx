// Calculators ▸ Thin Film tab — deposition / sputter rate, diffusion length,
// implant dose + peak concentration, Kiessig thickness, multilayer thermal
// conductivity, projected range, Stoney stress, thermal-mismatch strain
// (calc.thin_film, ports DiraCulator buildThinFilmTab + +calc/+thinFilm/*).
// Self-contained: owns its own local state so the shared useCalculators hook
// stays under the ceiling.

import { useState } from "react";

import { Button, NumberField } from "../../primitives";
import {
  thinFilmDepositionRate,
  thinFilmDiffusionLength,
  thinFilmDoseFromCurrent,
  thinFilmDoseToConcentration,
  thinFilmKiessig,
  thinFilmMultilayerThermal,
  thinFilmProjectedRange,
  thinFilmSputterRate,
  thinFilmStoneyStress,
  thinFilmThermalMismatch,
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
  numeric = true,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  width?: number;
  unit?: string;
  numeric?: boolean;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span className="qzk-field-lbl" style={{ margin: 0 }}>
        {label}
      </span>
      <NumberField
        value={value}
        width={width}
        onChange={onChange}
        unit={unit}
        numeric={numeric}
      />
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

/** Parse a comma/space separated numeric list. */
function parseList(s: string): number[] {
  return s
    .split(/[\s,]+/)
    .filter((x) => x.length > 0)
    .map(Number);
}

export default function ThinFilmTab() {
  // Card 1 — deposition rate.
  const [drThick, setDrThick] = useState("1000");
  const [drTime, setDrTime] = useState("60");
  const [c1, setC1] = useState<{ text: string; err?: boolean } | null>(null);

  // Card 2 — sputter rate.
  const [spY, setSpY] = useState("2.5");
  const [spJ, setSpJ] = useState("1.0");
  const [spRho, setSpRho] = useState("19.3");
  const [spM, setSpM] = useState("196.97");
  const [c2, setC2] = useState<{ text: string; err?: boolean } | null>(null);

  // Card 3 — thermal diffusion length.
  const [dlD, setDlD] = useState("1e-13");
  const [dlT, setDlT] = useState("3600");
  const [c3, setC3] = useState<{ text: string; err?: boolean } | null>(null);

  // Card 4 — implant dose from beam current.
  const [doseI, setDoseI] = useState("1e-6");
  const [doseT, setDoseT] = useState("60");
  const [doseA, setDoseA] = useState("1.0");
  const [c4, setC4] = useState<{ text: string; err?: boolean } | null>(null);

  // Card 5 — dose -> peak concentration.
  const [dcDose, setDcDose] = useState("1e15");
  const [dcRp, setDcRp] = useState("80");
  const [dcDRp, setDcDRp] = useState("25");
  const [c5, setC5] = useState<{ text: string; err?: boolean } | null>(null);

  // Card 6 — Kiessig thickness.
  const [kDq, setKDq] = useState("0.0628");
  const [kSld, setKSld] = useState("");
  const [c6, setC6] = useState<{ text: string; err?: boolean } | null>(null);

  // Card 7 — multilayer thermal conductivity.
  const [mlD, setMlD] = useState("100, 50");
  const [mlK, setMlK] = useState("1.4, 148");
  const [c7, setC7] = useState<{ text: string; err?: boolean } | null>(null);

  // Card 8 — projected range (LSS).
  const [prIon, setPrIon] = useState("Ar");
  const [prTarget, setPrTarget] = useState("Si");
  const [prE, setPrE] = useState("100");
  const [c8, setC8] = useState<{ text: string; err?: boolean } | null>(null);

  // Card 9 — Stoney stress (SI inputs).
  const [stEs, setStEs] = useState("130e9");
  const [stNu, setStNu] = useState("0.28");
  const [stTs, setStTs] = useState("500e-6");
  const [stTf, setStTf] = useState("100e-9");
  const [stR, setStR] = useState("10");
  const [c9, setC9] = useState<{ text: string; err?: boolean } | null>(null);

  // Card 10 — thermal-mismatch strain (E optional).
  const [tmAf, setTmAf] = useState("17e-6");
  const [tmAs, setTmAs] = useState("3e-6");
  const [tmDT, setTmDT] = useState("-500");
  const [tmE, setTmE] = useState("");
  const [tmNu, setTmNu] = useState("0.3");
  const [c10, setC10] = useState<{ text: string; err?: boolean } | null>(null);

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
      <Card title="Deposition rate">
        <div style={ROW}>
          <Field label="t" value={drThick} onChange={setDrThick} unit="Å" width={80} />
          <Field label="τ" value={drTime} onChange={setDrTime} unit="s" width={72} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC1, async () => {
                const r = await thinFilmDepositionRate(Number(drThick), Number(drTime));
                return `rate = ${fmtNum(r.rate)} Å/s · ${fmtNum(r.rate_nm_per_min)} nm/min`;
              })
            }
          >
            Calculate
          </Button>
        </div>
        {result(c1)}
      </Card>

      <Card title="Sputter rate">
        <div style={ROW}>
          <Field label="Y" value={spY} onChange={setSpY} width={56} />
          <Field label="J" value={spJ} onChange={setSpJ} unit="mA/cm²" width={56} />
          <Field label="ρ" value={spRho} onChange={setSpRho} unit="g/cm³" width={56} />
          <Field label="M" value={spM} onChange={setSpM} unit="g/mol" width={64} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC2, async () => {
                const r = await thinFilmSputterRate(
                  Number(spY),
                  Number(spJ),
                  Number(spRho),
                  Number(spM),
                );
                return `rate = ${fmtNum(r.rate)} nm/s · ${fmtNum(r.rate_nm_per_min)} nm/min`;
              })
            }
          >
            Calculate
          </Button>
        </div>
        {result(c2)}
      </Card>

      <Card title="Thermal diffusion length">
        <div style={ROW}>
          <Field label="D" value={dlD} onChange={setDlD} unit="cm²/s" width={72} />
          <Field label="t" value={dlT} onChange={setDlT} unit="s" width={72} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC3, async () => {
                const r = await thinFilmDiffusionLength(Number(dlD), Number(dlT));
                return `L = ${fmtNum(r.L)} cm · ${fmtNum(r.L_nm)} nm`;
              })
            }
          >
            Calculate
          </Button>
        </div>
        {result(c3)}
      </Card>

      <Card title="Implant dose (beam current)">
        <div style={ROW}>
          <Field label="I" value={doseI} onChange={setDoseI} unit="A" width={72} />
          <Field label="t" value={doseT} onChange={setDoseT} unit="s" width={64} />
          <Field label="A" value={doseA} onChange={setDoseA} unit="cm²" width={64} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC4, async () => {
                const r = await thinFilmDoseFromCurrent(
                  Number(doseI),
                  Number(doseT),
                  Number(doseA),
                );
                return `dose = ${fmtNum(r.dose)} ions/cm²`;
              })
            }
          >
            Calculate
          </Button>
        </div>
        {result(c4)}
      </Card>

      <Card title="Peak concentration (dose → C)">
        <div style={ROW}>
          <Field label="Φ" value={dcDose} onChange={setDcDose} unit="ions/cm²" width={72} />
          <Field label="Rp" value={dcRp} onChange={setDcRp} unit="nm" width={56} />
          <Field label="ΔRp" value={dcDRp} onChange={setDcDRp} unit="nm" width={56} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC5, async () => {
                const r = await thinFilmDoseToConcentration(
                  Number(dcDose),
                  Number(dcRp),
                  Number(dcDRp),
                );
                return `C_peak = ${fmtNum(r.Cpeak)} atoms/cm³`;
              })
            }
          >
            Calculate
          </Button>
        </div>
        {result(c5)}
      </Card>

      <Card title="Kiessig thickness">
        <div style={ROW}>
          <Field label="ΔQ" value={kDq} onChange={setKDq} unit="Å⁻¹" width={72} />
          <Field label="SLD" value={kSld} onChange={setKSld} unit="Å⁻² (opt)" width={72} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC6, async () => {
                const sld = kSld.trim() === "" ? undefined : Number(kSld);
                const r = await thinFilmKiessig(Number(kDq), sld);
                const corr = Number.isNaN(r.Qc) ? "" : ` (Qc = ${fmtNum(r.Qc)} Å⁻¹)`;
                return `t = ${fmtNum(r.thickness)} Å · ${fmtNum(r.thickness_nm)} nm${corr}`;
              })
            }
          >
            Calculate
          </Button>
        </div>
        {result(c6)}
      </Card>

      <Card title="Multilayer thermal conductivity">
        <div style={ROW}>
          <Field
            label="d (nm)"
            value={mlD}
            onChange={setMlD}
            width={120}
            numeric={false}
          />
          <Field
            label="k (W/m/K)"
            value={mlK}
            onChange={setMlK}
            width={120}
            numeric={false}
          />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC7, async () => {
                const r = await thinFilmMultilayerThermal(parseList(mlD), parseList(mlK));
                return `k⊥ = ${fmtNum(r.k_series)} · k∥ = ${fmtNum(r.k_parallel)} W/m/K`;
              })
            }
          >
            Calculate
          </Button>
        </div>
        {result(c7)}
      </Card>

      <Card title="Projected range (LSS)">
        <div style={ROW}>
          <Field label="ion" value={prIon} onChange={setPrIon} width={56} numeric={false} />
          <Field
            label="target"
            value={prTarget}
            onChange={setPrTarget}
            width={56}
            numeric={false}
          />
          <Field label="E" value={prE} onChange={setPrE} unit="keV" width={64} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC8, async () => {
                const r = await thinFilmProjectedRange(prIon, prTarget, Number(prE));
                return `Rp = ${fmtNum(r.Rp)} nm · ΔRp = ${fmtNum(r.deltaRp)} nm`;
              })
            }
          >
            Calculate
          </Button>
        </div>
        {result(c8)}
      </Card>

      <Card title="Stoney stress">
        <div style={ROW}>
          <Field label="Es" value={stEs} onChange={setStEs} unit="Pa" width={64} />
          <Field label="νs" value={stNu} onChange={setStNu} width={48} />
          <Field label="ts" value={stTs} onChange={setStTs} unit="m" width={64} />
          <Field label="tf" value={stTf} onChange={setStTf} unit="m" width={64} />
          <Field label="R" value={stR} onChange={setStR} unit="m" width={56} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC9, async () => {
                const r = await thinFilmStoneyStress(
                  Number(stEs),
                  Number(stNu),
                  Number(stTs),
                  Number(stTf),
                  Number(stR),
                );
                return `σ = ${fmtNum(r.stress_MPa)} MPa · ${fmtNum(r.stress_GPa)} GPa`;
              })
            }
          >
            Calculate
          </Button>
        </div>
        {result(c9)}
      </Card>

      <Card title="Thermal-mismatch strain">
        <div style={ROW}>
          <Field label="αf" value={tmAf} onChange={setTmAf} unit="1/K" width={64} />
          <Field label="αs" value={tmAs} onChange={setTmAs} unit="1/K" width={64} />
          <Field label="ΔT" value={tmDT} onChange={setTmDT} unit="K" width={56} />
          <Field label="E" value={tmE} onChange={setTmE} unit="Pa (opt)" width={64} />
          <Field label="ν" value={tmNu} onChange={setTmNu} width={48} />
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              void run(setC10, async () => {
                const e = tmE.trim() === "" ? undefined : Number(tmE);
                const r = await thinFilmThermalMismatch(
                  Number(tmAf),
                  Number(tmAs),
                  Number(tmDT),
                  e,
                  Number(tmNu),
                );
                const stress = Number.isNaN(r.stress_MPa)
                  ? ""
                  : ` · σ = ${fmtNum(r.stress_MPa)} MPa`;
                return `ε = ${fmtNum(r.strain)} (${r.description})${stress}`;
              })
            }
          >
            Calculate
          </Button>
        </div>
        {result(c10)}
      </Card>
    </div>
  );
}
