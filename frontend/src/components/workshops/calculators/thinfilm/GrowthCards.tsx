// Thin Film cards 1–5 (growth + implant dosing): deposition rate, sputter
// rate, thermal diffusion length, implant dose from beam current, dose →
// peak concentration. Split from ThinFilmTab.tsx (MAIN_PLAN #1); the card
// ORDER matters — ThinFilmTab composes these before FilmCards, preserving
// the original "Calculate" button indices the tests click by position.

import { useState } from "react";

import {
  thinFilmDepositionRate,
  thinFilmDiffusionLength,
  thinFilmDoseFromCurrent,
  thinFilmDoseToConcentration,
  thinFilmSputterRate,
} from "../../../../lib/api";
import { Button, Card, Field, ROW, fmtNum, resultLine, runCalc, type CardResult } from "./shared";

/** Card 1 — deposition rate. */
export function DepositionRateCard() {
  const [drThick, setDrThick] = useState("1000");
  const [drTime, setDrTime] = useState("60");
  const [c1, setC1] = useState<CardResult>(null);

  return (
    <Card title="Deposition rate">
      <div style={ROW}>
        <Field label="t" value={drThick} onChange={setDrThick} unit="Å" width={80} />
        <Field label="τ" value={drTime} onChange={setDrTime} unit="s" width={72} />
        <Button
          variant="primary"
          size="sm"
          onClick={() =>
            void runCalc(setC1, "Deposition rate", async () => {
              const r = await thinFilmDepositionRate(Number(drThick), Number(drTime));
              return `rate = ${fmtNum(r.rate)} Å/s · ${fmtNum(r.rate_nm_per_min)} nm/min`;
            })
          }
        >
          Calculate
        </Button>
      </div>
      {resultLine(c1)}
    </Card>
  );
}

/** Card 2 — sputter rate. */
export function SputterRateCard() {
  const [spY, setSpY] = useState("2.5");
  const [spJ, setSpJ] = useState("1.0");
  const [spRho, setSpRho] = useState("19.3");
  const [spM, setSpM] = useState("196.97");
  const [c2, setC2] = useState<CardResult>(null);

  return (
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
            void runCalc(setC2, "Sputter rate", async () => {
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
      {resultLine(c2)}
    </Card>
  );
}

/** Card 3 — thermal diffusion length. */
export function DiffusionLengthCard() {
  const [dlD, setDlD] = useState("1e-13");
  const [dlT, setDlT] = useState("3600");
  const [c3, setC3] = useState<CardResult>(null);

  return (
    <Card title="Thermal diffusion length">
      <div style={ROW}>
        <Field label="D" value={dlD} onChange={setDlD} unit="cm²/s" width={72} />
        <Field label="t" value={dlT} onChange={setDlT} unit="s" width={72} />
        <Button
          variant="primary"
          size="sm"
          onClick={() =>
            void runCalc(setC3, "Thermal diffusion length", async () => {
              const r = await thinFilmDiffusionLength(Number(dlD), Number(dlT));
              return `L = ${fmtNum(r.L)} cm · ${fmtNum(r.L_nm)} nm`;
            })
          }
        >
          Calculate
        </Button>
      </div>
      {resultLine(c3)}
    </Card>
  );
}

/** Card 4 — implant dose from beam current. */
export function ImplantDoseCard() {
  const [doseI, setDoseI] = useState("1e-6");
  const [doseT, setDoseT] = useState("60");
  const [doseA, setDoseA] = useState("1.0");
  const [c4, setC4] = useState<CardResult>(null);

  return (
    <Card title="Implant dose (beam current)">
      <div style={ROW}>
        <Field label="I" value={doseI} onChange={setDoseI} unit="A" width={72} />
        <Field label="t" value={doseT} onChange={setDoseT} unit="s" width={64} />
        <Field label="A" value={doseA} onChange={setDoseA} unit="cm²" width={64} />
        <Button
          variant="primary"
          size="sm"
          onClick={() =>
            void runCalc(setC4, "Implant dose (beam current)", async () => {
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
      {resultLine(c4)}
    </Card>
  );
}

/** Card 5 — dose -> peak concentration. */
export function PeakConcentrationCard() {
  const [dcDose, setDcDose] = useState("1e15");
  const [dcRp, setDcRp] = useState("80");
  const [dcDRp, setDcDRp] = useState("25");
  const [c5, setC5] = useState<CardResult>(null);

  return (
    <Card title="Peak concentration (dose → C)">
      <div style={ROW}>
        <Field label="Φ" value={dcDose} onChange={setDcDose} unit="ions/cm²" width={72} />
        <Field label="Rp" value={dcRp} onChange={setDcRp} unit="nm" width={56} />
        <Field label="ΔRp" value={dcDRp} onChange={setDcDRp} unit="nm" width={56} />
        <Button
          variant="primary"
          size="sm"
          onClick={() =>
            void runCalc(setC5, "Peak concentration", async () => {
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
      {resultLine(c5)}
    </Card>
  );
}
