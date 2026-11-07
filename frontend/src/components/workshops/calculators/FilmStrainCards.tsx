// Calculators ▸ Crystal tab — epitaxial-film strain and atomic-density cards:
// MATLAB DiraCulator buildCrystalTab Cards 6–8 (tetragonalDistortion,
// strainFromPoisson, atomicDensity → calc.epitaxial_strain and
// calc.crystallography.atomic_density). Self-contained like the thin-film
// cards: each owns its inputs and its `useCard`. None reads the tab's shared
// lattice — the MATLAB cards have their own fields too. Defaults are the
// MATLAB card defaults.

import { useState } from "react";

import {
  crystalAtomicDensity,
  crystalPoissonStrain,
  crystalTetragonalDistortion,
} from "../../../lib/api/crystallography";
import { Button, Card, Field, ROW, dual, resultLine, useCard, withTouch } from "./shared";

/** Card 6 — c/a and tetragonal distortion of a strained film. */
export function TetragonalDistortionCard() {
  const [aRelaxed, setARelaxed] = useState("3.905");
  const [cMeasured, setCMeasured] = useState("3.92");
  const [cRelaxed, setCRelaxed] = useState("3.905");
  const card = useCard("Crystal");

  return (
    <Card title="Tetragonal distortion">
      <div style={ROW}>
        <Field label="a relaxed" value={aRelaxed} onChange={withTouch(card.touch, setARelaxed)} unit="Å" width={72} />
        <Field label="c measured" value={cMeasured} onChange={withTouch(card.touch, setCMeasured)} unit="Å" width={72} />
        <Field label="c relaxed" value={cRelaxed} onChange={withTouch(card.touch, setCRelaxed)} unit="Å" width={72} />
        <Button
          variant="primary"
          size="sm"
          onClick={() =>
            void card.run(
              "Tetragonal distortion",
              `a_relaxed=${aRelaxed} Å, c_measured=${cMeasured} Å, c_relaxed=${cRelaxed} Å`,
              async () => {
                const r = await crystalTetragonalDistortion({
                  a_relaxed: Number(aRelaxed),
                  c_measured: Number(cMeasured),
                  // Blank keeps the cubic default (c_relaxed = a_relaxed).
                  ...(cRelaxed.trim() === "" ? {} : { c_relaxed: Number(cRelaxed) }),
                });
                return dual`c/a = ${r.c_over_a} · distortion = ${r.distortion_pct} %`;
              },
            )
          }
        >
          Calculate
        </Button>
      </div>
      <div className="qzk-ds-meta" style={{ marginTop: 6 }}>
        Leave c relaxed blank for a cubic bulk reference (c relaxed = a relaxed).
      </div>
      {resultLine(card.result)}
    </Card>
  );
}

/** Card 7 — out-of-plane strain from biaxial in-plane strain. */
export function PoissonStrainCard() {
  const [eps, setEps] = useState("0.01");
  const [nu, setNu] = useState("0.3");
  const card = useCard("Crystal");

  return (
    <Card title="Strain from Poisson ratio">
      <div style={ROW}>
        <Field label="ε∥" ariaLabel="in-plane strain" value={eps} onChange={withTouch(card.touch, setEps)} width={72} />
        <Field label="ν" ariaLabel="Poisson ratio" value={nu} onChange={withTouch(card.touch, setNu)} width={60} />
        <Button
          variant="primary"
          size="sm"
          onClick={() =>
            void card.run("Strain from Poisson ratio", `eps_parallel=${eps}, nu=${nu}`, async () => {
              const r = await crystalPoissonStrain({ eps_parallel: Number(eps), nu: Number(nu) });
              return dual`ε⊥ = ${r.eps_perp} · ε∥ = ${r.eps_parallel}`;
            })
          }
        >
          Calculate
        </Button>
      </div>
      <div className="qzk-ds-meta" style={{ marginTop: 6 }}>
        Biaxial strain with a free surface: ε⊥ = −2ν/(1−ν)·ε∥ (dimensionless; 0.01 = 1 %).
      </div>
      {resultLine(card.result)}
    </Card>
  );
}

/** Card 8 — atomic number density from the cell and atoms per cell. */
export function AtomicDensityCard() {
  const [a, setA] = useState("3.905");
  const [b, setB] = useState("3.905");
  const [c, setC] = useState("3.905");
  const [z, setZ] = useState("1");
  const card = useCard("Crystal");

  return (
    <Card title="Atomic density">
      <div style={ROW}>
        <Field label="a" ariaLabel="density a" value={a} onChange={withTouch(card.touch, setA)} unit="Å" width={64} />
        <Field label="b" ariaLabel="density b" value={b} onChange={withTouch(card.touch, setB)} unit="Å" width={64} />
        <Field label="c" ariaLabel="density c" value={c} onChange={withTouch(card.touch, setC)} unit="Å" width={64} />
        <Field label="Z" ariaLabel="atoms per cell" value={z} onChange={withTouch(card.touch, setZ)} width={52} />
        <Button
          variant="primary"
          size="sm"
          onClick={() =>
            void card.run("Atomic density", `a=${a} Å, b=${b} Å, c=${c} Å, Z=${z} atoms/cell`, async () => {
              const r = await crystalAtomicDensity({ a: Number(a), b: Number(b), c: Number(c), z: Number(z) });
              return dual`n = ${r.density} atoms/cm³ · V = ${r.volume} Å³`;
            })
          }
        >
          Calculate
        </Button>
      </div>
      <div className="qzk-ds-meta" style={{ marginTop: 6 }}>
        Orthogonal cell (angles 90°); Z is atoms, not formula units, per cell.
      </div>
      {resultLine(card.result)}
    </Card>
  );
}
