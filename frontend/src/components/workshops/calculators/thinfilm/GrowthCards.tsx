// Thin Film cards 1–5 (growth + implant dosing): deposition rate, sputter
// rate, thermal diffusion length, implant dose from beam current, dose →
// peak concentration. Split from ThinFilmTab.tsx (MAIN_PLAN #1); the card
// ORDER matters — ThinFilmTab composes these before FilmCards, preserving
// the original "Calculate" button indices the tests click by position.

import { useState } from "react";

import { thinFilmDepositionRate, thinFilmDiffusionLength, thinFilmDoseFromCurrent, thinFilmDoseToConcentration, thinFilmSputterRate } from "../../../../lib/api/thinFilm";
import {
  Button,
  Card,
  Field,
  ROW,
  fmtNum,
  resultLine,
  useCard,
  withTouch,
} from "../shared";

/** Card 1 — deposition rate. */
export function DepositionRateCard() {
  const [drThick, setDrThick] = useState("1000");
  const [drTime, setDrTime] = useState("60");
  const c1 = useCard("Thin Film");

  return (
    <Card title="Deposition rate">
      <div style={ROW}>
        <Field label="t" value={drThick} onChange={withTouch(c1.touch, setDrThick)} unit="Å" width={80} />
        <Field label="τ" value={drTime} onChange={withTouch(c1.touch, setDrTime)} unit="s" width={72} />
        <Button
          variant="primary"
          size="sm"
          onClick={() =>
            void c1.run("Deposition rate", async () => {
              const r = await thinFilmDepositionRate(Number(drThick), Number(drTime));
              return `rate = ${fmtNum(r.rate)} Å/s · ${fmtNum(r.rate_nm_per_min)} nm/min`;
            })
          }
        >
          Calculate
        </Button>
      </div>
      {resultLine(c1.result)}
    </Card>
  );
}

/** Card 2 — sputter rate. */
export function SputterRateCard() {
  const [spY, setSpY] = useState("2.5");
  const [spJ, setSpJ] = useState("1.0");
  const [spRho, setSpRho] = useState("19.3");
  const [spM, setSpM] = useState("196.97");
  const c2 = useCard("Thin Film");

  return (
    <Card title="Sputter rate">
      <div style={ROW}>
        <Field label="Y" value={spY} onChange={withTouch(c2.touch, setSpY)} width={56} />
        <Field label="J" value={spJ} onChange={withTouch(c2.touch, setSpJ)} unit="mA/cm²" width={56} />
        <Field label="ρ" value={spRho} onChange={withTouch(c2.touch, setSpRho)} unit="g/cm³" width={56} />
        <Field label="M" value={spM} onChange={withTouch(c2.touch, setSpM)} unit="g/mol" width={64} />
        <Button
          variant="primary"
          size="sm"
          onClick={() =>
            void c2.run("Sputter rate", async () => {
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
      {resultLine(c2.result)}
    </Card>
  );
}

/** Card 3 — thermal diffusion length. */
export function DiffusionLengthCard() {
  const [dlD, setDlD] = useState("1e-13");
  const [dlT, setDlT] = useState("3600");
  const c3 = useCard("Thin Film");

  return (
    <Card title="Thermal diffusion length">
      <div style={ROW}>
        <Field label="D" value={dlD} onChange={withTouch(c3.touch, setDlD)} unit="cm²/s" width={72} />
        <Field label="t" value={dlT} onChange={withTouch(c3.touch, setDlT)} unit="s" width={72} />
        <Button
          variant="primary"
          size="sm"
          onClick={() =>
            void c3.run("Thermal diffusion length", async () => {
              const r = await thinFilmDiffusionLength(Number(dlD), Number(dlT));
              return `L = ${fmtNum(r.L)} cm · ${fmtNum(r.L_nm)} nm`;
            })
          }
        >
          Calculate
        </Button>
      </div>
      {resultLine(c3.result)}
    </Card>
  );
}

/** Card 4 — implant dose from beam current. */
export function ImplantDoseCard() {
  const [doseI, setDoseI] = useState("1e-6");
  const [doseT, setDoseT] = useState("60");
  const [doseA, setDoseA] = useState("1.0");
  const c4 = useCard("Thin Film");

  return (
    <Card title="Implant dose (beam current)">
      <div style={ROW}>
        <Field label="I" value={doseI} onChange={withTouch(c4.touch, setDoseI)} unit="A" width={72} />
        <Field label="t" value={doseT} onChange={withTouch(c4.touch, setDoseT)} unit="s" width={64} />
        <Field label="A" value={doseA} onChange={withTouch(c4.touch, setDoseA)} unit="cm²" width={64} />
        <Button
          variant="primary"
          size="sm"
          onClick={() =>
            void c4.run("Implant dose (beam current)", async () => {
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
      {resultLine(c4.result)}
    </Card>
  );
}

/** Card 5 — dose -> peak concentration. */
export function PeakConcentrationCard() {
  const [dcDose, setDcDose] = useState("1e15");
  const [dcRp, setDcRp] = useState("80");
  const [dcDRp, setDcDRp] = useState("25");
  const c5 = useCard("Thin Film");

  return (
    <Card title="Peak concentration (dose → C)">
      <div style={ROW}>
        <Field label="Φ" value={dcDose} onChange={withTouch(c5.touch, setDcDose)} unit="ions/cm²" width={72} />
        <Field label="Rp" value={dcRp} onChange={withTouch(c5.touch, setDcRp)} unit="nm" width={56} />
        <Field label="ΔRp" value={dcDRp} onChange={withTouch(c5.touch, setDcDRp)} unit="nm" width={56} />
        <Button
          variant="primary"
          size="sm"
          onClick={() =>
            void c5.run("Peak concentration", async () => {
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
      {resultLine(c5.result)}
    </Card>
  );
}
