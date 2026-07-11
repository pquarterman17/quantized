// Thin Film cards 6–10 (film characterization + mechanics): Kiessig
// thickness, multilayer thermal conductivity, projected range (LSS), Stoney
// stress, thermal-mismatch strain. Split from ThinFilmTab.tsx (MAIN_PLAN #1);
// composed after GrowthCards — the card ORDER preserves the original
// "Calculate" button indices the tests click by position.

import { useState } from "react";

import {
  thinFilmKiessig,
  thinFilmMultilayerThermal,
  thinFilmProjectedRange,
  thinFilmStoneyStress,
  thinFilmThermalMismatch,
} from "../../../../lib/api";
import {
  Button,
  Card,
  Field,
  ROW,
  fmtNum,
  parseList,
  resultLine,
  runCalc,
  type CardResult,
} from "./shared";

/** Card 6 — Kiessig thickness. */
export function KiessigCard() {
  const [kDq, setKDq] = useState("0.0628");
  const [kSld, setKSld] = useState("");
  const [c6, setC6] = useState<CardResult>(null);

  return (
    <Card title="Kiessig thickness">
      <div style={ROW}>
        <Field label="ΔQ" value={kDq} onChange={setKDq} unit="Å⁻¹" width={72} />
        <Field label="SLD" value={kSld} onChange={setKSld} unit="Å⁻² (opt)" width={72} />
        <Button
          variant="primary"
          size="sm"
          onClick={() =>
            void runCalc(setC6, "Kiessig thickness", async () => {
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
      {resultLine(c6)}
    </Card>
  );
}

/** Card 7 — multilayer thermal conductivity. */
export function MultilayerThermalCard() {
  const [mlD, setMlD] = useState("100, 50");
  const [mlK, setMlK] = useState("1.4, 148");
  const [c7, setC7] = useState<CardResult>(null);

  return (
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
            void runCalc(setC7, "Multilayer thermal conductivity", async () => {
              const r = await thinFilmMultilayerThermal(parseList(mlD), parseList(mlK));
              return `k⊥ = ${fmtNum(r.k_series)} · k∥ = ${fmtNum(r.k_parallel)} W/m/K`;
            })
          }
        >
          Calculate
        </Button>
      </div>
      {resultLine(c7)}
    </Card>
  );
}

/** Card 8 — projected range (LSS). */
export function ProjectedRangeCard() {
  const [prIon, setPrIon] = useState("Ar");
  const [prTarget, setPrTarget] = useState("Si");
  const [prE, setPrE] = useState("100");
  const [c8, setC8] = useState<CardResult>(null);

  return (
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
            void runCalc(setC8, "Projected range (LSS)", async () => {
              const r = await thinFilmProjectedRange(prIon, prTarget, Number(prE));
              return `Rp = ${fmtNum(r.Rp)} nm · ΔRp = ${fmtNum(r.deltaRp)} nm`;
            })
          }
        >
          Calculate
        </Button>
      </div>
      {resultLine(c8)}
    </Card>
  );
}

/** Card 9 — Stoney stress (SI inputs). */
export function StoneyStressCard() {
  const [stEs, setStEs] = useState("130e9");
  const [stNu, setStNu] = useState("0.28");
  const [stTs, setStTs] = useState("500e-6");
  const [stTf, setStTf] = useState("100e-9");
  const [stR, setStR] = useState("10");
  const [c9, setC9] = useState<CardResult>(null);

  return (
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
            void runCalc(setC9, "Stoney stress", async () => {
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
      {resultLine(c9)}
    </Card>
  );
}

/** Card 10 — thermal-mismatch strain (E optional). */
export function ThermalMismatchCard() {
  const [tmAf, setTmAf] = useState("17e-6");
  const [tmAs, setTmAs] = useState("3e-6");
  const [tmDT, setTmDT] = useState("-500");
  const [tmE, setTmE] = useState("");
  const [tmNu, setTmNu] = useState("0.3");
  const [c10, setC10] = useState<CardResult>(null);

  return (
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
            void runCalc(setC10, "Thermal-mismatch strain", async () => {
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
      {resultLine(c10)}
    </Card>
  );
}
