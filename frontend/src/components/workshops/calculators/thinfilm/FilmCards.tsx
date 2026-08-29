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
  thinFilmSauerbrey,
  thinFilmScherrer,
  thinFilmStoneyStress,
  thinFilmThermalMismatch,
} from "../../../../lib/api/thinFilm";
import {
  Button,
  Card,
  Field,
  ROW,
  fmtNum,
  parseList,
  resultLine,
  useCard,
  withTouch,
} from "../shared";

/** Card 6 — Kiessig thickness. */
export function KiessigCard() {
  const [kDq, setKDq] = useState("0.0628");
  const [kSld, setKSld] = useState("");
  const c6 = useCard("Thin Film");

  return (
    <Card title="Kiessig thickness">
      <div style={ROW}>
        <Field label="ΔQ" value={kDq} onChange={withTouch(c6.touch, setKDq)} unit="Å⁻¹" width={72} />
        <Field label="SLD" value={kSld} onChange={withTouch(c6.touch, setKSld)} unit="Å⁻² (opt)" width={72} />
        <Button
          variant="primary"
          size="sm"
          onClick={() =>
            void c6.run("Kiessig thickness", `ΔQ=${kDq} Å⁻¹, SLD=${kSld} Å⁻²`, async () => {
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
      {resultLine(c6.result)}
    </Card>
  );
}

/** Card 7 — multilayer thermal conductivity. */
export function MultilayerThermalCard() {
  const [mlD, setMlD] = useState("100, 50");
  const [mlK, setMlK] = useState("1.4, 148");
  const c7 = useCard("Thin Film");

  return (
    <Card title="Multilayer thermal conductivity">
      <div style={ROW}>
        <Field
          label="d (nm)"
          value={mlD}
          onChange={withTouch(c7.touch, setMlD)}
          width={120}
          numeric={false}
        />
        <Field
          label="k (W/m/K)"
          value={mlK}
          onChange={withTouch(c7.touch, setMlK)}
          width={120}
          numeric={false}
        />
        <Button
          variant="primary"
          size="sm"
          onClick={() =>
            void c7.run(
              "Multilayer thermal conductivity",
              `d=${JSON.stringify(mlD)} nm, k=${JSON.stringify(mlK)} W/m/K`,
              async () => {
              const r = await thinFilmMultilayerThermal(parseList(mlD), parseList(mlK));
              return `k⊥ = ${fmtNum(r.k_series)} · k∥ = ${fmtNum(r.k_parallel)} W/m/K`;
              },
            )
          }
        >
          Calculate
        </Button>
      </div>
      {resultLine(c7.result)}
    </Card>
  );
}

/** Card 8 — projected range (LSS). */
export function ProjectedRangeCard() {
  const [prIon, setPrIon] = useState("Ar");
  const [prTarget, setPrTarget] = useState("Si");
  const [prE, setPrE] = useState("100");
  const c8 = useCard("Thin Film");

  return (
    <Card title="Projected range (LSS)">
      <div style={ROW}>
        <Field label="ion" value={prIon} onChange={withTouch(c8.touch, setPrIon)} width={56} numeric={false} />
        <Field
          label="target"
          value={prTarget}
          onChange={withTouch(c8.touch, setPrTarget)}
          width={56}
          numeric={false}
        />
        <Field label="E" value={prE} onChange={withTouch(c8.touch, setPrE)} unit="keV" width={64} />
        <Button
          variant="primary"
          size="sm"
          onClick={() =>
            void c8.run(
              "Projected range (LSS)",
              `ion=${prIon}, target=${prTarget}, E=${prE} keV`,
              async () => {
              const r = await thinFilmProjectedRange(prIon, prTarget, Number(prE));
              return `Rp = ${fmtNum(r.Rp)} nm · ΔRp = ${fmtNum(r.deltaRp)} nm`;
              },
            )
          }
        >
          Calculate
        </Button>
      </div>
      {resultLine(c8.result)}
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
  const c9 = useCard("Thin Film");

  return (
    <Card title="Stoney stress">
      <div style={ROW}>
        <Field label="Es" value={stEs} onChange={withTouch(c9.touch, setStEs)} unit="Pa" width={64} />
        <Field label="νs" value={stNu} onChange={withTouch(c9.touch, setStNu)} width={48} />
        <Field label="ts" value={stTs} onChange={withTouch(c9.touch, setStTs)} unit="m" width={64} />
        <Field label="tf" value={stTf} onChange={withTouch(c9.touch, setStTf)} unit="m" width={64} />
        <Field label="R" value={stR} onChange={withTouch(c9.touch, setStR)} unit="m" width={56} />
        <Button
          variant="primary"
          size="sm"
          onClick={() =>
            void c9.run(
              "Stoney stress",
              `E_s=${stEs} Pa, ν_s=${stNu}, t_s=${stTs} m, t_f=${stTf} m, R=${stR} m`,
              async () => {
              const r = await thinFilmStoneyStress(
                Number(stEs),
                Number(stNu),
                Number(stTs),
                Number(stTf),
                Number(stR),
              );
              return `σ = ${fmtNum(r.stress_MPa)} MPa · ${fmtNum(r.stress_GPa)} GPa`;
              },
            )
          }
        >
          Calculate
        </Button>
      </div>
      {resultLine(c9.result)}
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
  const c10 = useCard("Thin Film");

  return (
    <Card title="Thermal-mismatch strain">
      <div style={ROW}>
        <Field label="αf" value={tmAf} onChange={withTouch(c10.touch, setTmAf)} unit="1/K" width={64} />
        <Field label="αs" value={tmAs} onChange={withTouch(c10.touch, setTmAs)} unit="1/K" width={64} />
        <Field label="ΔT" value={tmDT} onChange={withTouch(c10.touch, setTmDT)} unit="K" width={56} />
        <Field label="E" value={tmE} onChange={withTouch(c10.touch, setTmE)} unit="Pa (opt)" width={64} />
        <Field label="ν" value={tmNu} onChange={withTouch(c10.touch, setTmNu)} width={48} />
        <Button
          variant="primary"
          size="sm"
          onClick={() =>
            void c10.run(
              "Thermal-mismatch strain",
              `α_f=${tmAf} 1/K, α_s=${tmAs} 1/K, ΔT=${tmDT} K, E=${tmE} Pa, ν=${tmNu}`,
              async () => {
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
              },
            )
          }
        >
          Calculate
        </Button>
      </div>
      {resultLine(c10.result)}
    </Card>
  );
}

/** Card 11 — Sauerbrey QCM areal mass / thickness. */
export function SauerbreyCard() {
  const [sfDf, setSfDf] = useState("-10");
  const [sfF0, setSfF0] = useState("5e6");
  const [sfArea, setSfArea] = useState("");
  const [sfRho, setSfRho] = useState("");
  const c11 = useCard("Thin Film");

  return (
    <Card title="Sauerbrey (QCM)">
      <div style={ROW}>
        <Field label="Δf" value={sfDf} onChange={withTouch(c11.touch, setSfDf)} unit="Hz" width={64} />
        <Field label="f₀" value={sfF0} onChange={withTouch(c11.touch, setSfF0)} unit="Hz" width={72} />
        <Field label="A" value={sfArea} onChange={withTouch(c11.touch, setSfArea)} unit="cm² (opt)" width={72} />
        <Field label="ρ" value={sfRho} onChange={withTouch(c11.touch, setSfRho)} unit="g/cm³ (opt)" width={80} />
        <Button
          variant="primary"
          size="sm"
          onClick={() =>
            void c11.run(
              "Sauerbrey (QCM)",
              `Δf=${sfDf} Hz, f₀=${sfF0} Hz, A=${sfArea} cm², ρ=${sfRho} g/cm³`,
              async () => {
              const area = sfArea.trim() === "" ? undefined : Number(sfArea);
              const density = sfRho.trim() === "" ? undefined : Number(sfRho);
              const r = await thinFilmSauerbrey(Number(sfDf), Number(sfF0), area, density);
              let s = `Δm/A = ${fmtNum(r.areal_mass_ng_cm2)} ng/cm² · Cf = ${fmtNum(
                r.Cf_hz_cm2_ug,
              )} Hz·cm²/µg`;
              if (r.thickness_nm != null) s += ` · t = ${fmtNum(r.thickness_nm)} nm`;
              return s;
              },
            )
          }
        >
          Calculate
        </Button>
      </div>
      {resultLine(c11.result)}
    </Card>
  );
}

/** Card 12 — Scherrer crystallite size (DiraCulator Thin Film Card 6). */
export function ScherrerCard() {
  const [fwhm, setFwhm] = useState("0.5");
  const [wavelength, setWavelength] = useState("1.5406");
  const [twoTheta, setTwoTheta] = useState("33");
  const c12 = useCard("Thin Film");

  return (
    <Card title="Scherrer grain size">
      <div style={ROW}>
        <Field label="FWHM" value={fwhm} onChange={withTouch(c12.touch, setFwhm)} unit="° 2θ" width={64} />
        <Field label="λ" value={wavelength} onChange={withTouch(c12.touch, setWavelength)} unit="Å" width={64} />
        <Field label="2θ" value={twoTheta} onChange={withTouch(c12.touch, setTwoTheta)} unit="°" width={56} />
        <Button
          variant="primary"
          size="sm"
          onClick={() =>
            void c12.run(
              "Scherrer grain size",
              `FWHM=${fwhm} ° 2θ, λ=${wavelength} Å, 2θ=${twoTheta} °`,
              async () => {
              const r = await thinFilmScherrer(Number(fwhm), Number(wavelength), Number(twoTheta));
              return `D = ${fmtNum(r.D)} Å · ${fmtNum(r.D_nm)} nm`;
              },
            )
          }
        >
          Calculate
        </Button>
      </div>
      {resultLine(c12.result)}
    </Card>
  );
}
