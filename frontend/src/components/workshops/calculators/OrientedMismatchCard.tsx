// Calculators ▸ Substrates — orientation-aware mismatch (plan G1 core,
// calc.surface_net). Unlike the scalar a_film/a_sub card above it, this one
// compares the in-plane lattices ("surface nets") of a film plane and a
// substrate plane, including Bravais centering, so Si(100) and Si(111) differ
// and Fe(001) on MgO(001) finds the 45°-rotated −3.7 % match. Both sides come
// from the reference phase table (it carries the centering the substrate
// table lacks). "Search supercells" runs the coincidence-lattice search
// (calc.coincidence) on the same two planes and lists the best matches with
// their rotation and epitaxial relationship.

import { useState } from "react";

import {
  coincidenceSearch,
  netMismatch,
  type CoincidenceMatch,
  type PlaneSpec,
} from "../../../lib/api/epitaxy";
import type { PhaseInfo } from "../../../lib/api/reference";
import PhasePresetPicker from "../structures/PhasePresetPicker";
import { Button, Card, Field, ROW, dual, fmtNum, resultLine, useCard, withTouch } from "./shared";

/** "1 1 1", "1,1,1", "0 0 0 1" or "11-20" → integer indices. */
export function parseMiller(text: string): number[] {
  const t = text.trim().replace(/[()[\]]/g, "");
  const parts = /[\s,]/.test(t)
    ? t.split(/[\s,]+/).filter(Boolean)
    : (t.match(/-?\d/g) ?? []);
  const idx = parts.map(Number);
  if ((idx.length !== 3 && idx.length !== 4) || idx.some((n) => !Number.isInteger(n))) {
    throw new Error(`enter Miller indices as "h k l" or "h k i l" (got "${text}")`);
  }
  return idx;
}

function planeOf(p: PhaseInfo, hkl: string): PlaneSpec {
  return {
    a: p.a, b: p.b, c: p.c, alpha: p.alpha, beta: p.beta, gamma: p.gamma,
    centering: p.centering, hkl: parseMiller(hkl),
  };
}

const netText = (n: { u: number; v: number; gamma: number }) => dual`${n.u} × ${n.v} Å, ${n.gamma}°`;

/** [1 2 0], or the 4-index [0 1 -1 0] when the cell has hexagonal axes. */
const dirText = (three: number[], four: number[] | null): string => `[${(four ?? three).join(" ")}]`;

export default function OrientedMismatchCard() {
  const [film, setFilm] = useState<PhaseInfo | null>(null);
  const [filmHkl, setFilmHkl] = useState("0 0 1");
  const [sub, setSub] = useState<PhaseInfo | null>(null);
  const [subHkl, setSubHkl] = useState("0 0 1");
  const card = useCard("Substrates");
  const search = useCard("Substrates");
  const [maxStrain, setMaxStrain] = useState("5");
  const [maxArea, setMaxArea] = useState("200");
  const [matches, setMatches] = useState<CoincidenceMatch[]>([]);
  // Any input change makes both results stale.
  const touchBoth = (): void => {
    card.touch();
    search.touch();
  };

  const run = (): void => {
    void card.run(
      "Orientation-aware mismatch",
      `film=${film?.name ?? "—"} (${filmHkl}), substrate=${sub?.name ?? "—"} (${subHkl})`,
      async () => {
        if (!film || !sub) throw new Error("choose a film phase and a substrate phase");
        const r = await netMismatch(planeOf(film, filmHkl), planeOf(sub, subHkl));
        const fNet = netText(r.film);
        const sNet = netText(r.substrate);
        const fit = dual`f = ${r.f_u_pct} % / ${r.f_v_pct} % along the two net axes · area ${r.f_area_pct} % · Δγ = ${r.delta_gamma}°`;
        return {
          text: `${fit.text} — film net ${fNet.text}; substrate net ${sNet.text}`,
          copyValue: `${fit.copyValue} — film net ${fNet.copyValue}; substrate net ${sNet.copyValue}`,
        };
      },
    );
  };

  const runSearch = (): void => {
    void search.run(
      "Coincidence search",
      `film=${film?.name ?? "—"} (${filmHkl}), substrate=${sub?.name ?? "—"} (${subHkl}), max strain ${maxStrain} %, max area ${maxArea} Å²`,
      async (isCurrent) => {
        if (!film || !sub) throw new Error("choose a film phase and a substrate phase");
        const strain = Number(maxStrain) / 100;
        const area = Number(maxArea);
        if (!(strain > 0) || !(area > 0)) throw new Error("enter a positive max strain and max area");
        const r = await coincidenceSearch(planeOf(film, filmHkl), planeOf(sub, subHkl), {
          max_strain: strain,
          max_area: area,
        });
        if (isCurrent()) setMatches(r.matches);
        const text =
          r.matches.length === 0
            ? `no coincidence within ${maxStrain} % and ${maxArea} Å²`
            : `${r.n_found} distinct matches; best ${r.matches[0].film_index}:${r.matches[0].substrate_index} cells, rotation ${fmtNum(r.matches[0].rotation)}° (rotations folded to ±${r.rotation_period / 2}°)`;
        return { text, copyValue: JSON.stringify(r.matches) };
      },
    );
  };
  const showMatches = search.result != null && !("err" in search.result) && matches.length > 0;

  return (
    <Card title="Orientation-aware mismatch (surface nets)">
      <div style={ROW}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <PhasePresetPicker
            label="oriented film phase"
            selected={film?.name ?? ""}
            onApply={(_p, phase) => {
              setFilm(phase);
              touchBoth();
            }}
          />
        </div>
        <Field label="(hkl)" ariaLabel="film plane" value={filmHkl} onChange={withTouch(touchBoth, setFilmHkl)} numeric={false} width={72} />
      </div>
      <div style={{ ...ROW, marginTop: 6 }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <PhasePresetPicker
            label="oriented substrate phase"
            selected={sub?.name ?? ""}
            onApply={(_p, phase) => {
              setSub(phase);
              touchBoth();
            }}
          />
        </div>
        <Field label="(hkl)" ariaLabel="substrate plane" value={subHkl} onChange={withTouch(touchBoth, setSubHkl)} numeric={false} width={72} />
        <Button variant="primary" size="sm" onClick={run}>
          Compare
        </Button>
      </div>
      <div className="qzk-ds-meta" style={{ marginTop: 6 }}>
        Compare: the two reduced in-plane lattices, centering included, with their axes aligned. A
        rotated or supercell match (e.g. GaN on c-plane sapphire, √3×√3 R30°) needs the search below.
      </div>
      {resultLine(card.result)}
      <div style={{ ...ROW, marginTop: 8 }}>
        <Field label="max strain" value={maxStrain} onChange={withTouch(search.touch, setMaxStrain)} unit="%" width={48} />
        <Field label="max area" value={maxArea} onChange={withTouch(search.touch, setMaxArea)} unit="Å²" width={60} />
        <Button variant="primary" size="sm" onClick={runSearch}>
          Search supercells
        </Button>
      </div>
      {resultLine(search.result)}
      {showMatches && (
        <div style={{ maxHeight: 220, overflowY: "auto", marginTop: 6 }}>
          <table className="qz-table" aria-label="coincidence matches">
            <thead>
              <tr>
                <th>cells (film:sub)</th>
                <th>f₁, f₂ (%)</th>
                <th>rotation (°)</th>
                <th>film ∥ substrate</th>
                <th>area (Å²)</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((m, i) => (
                <tr key={i}>
                  <td>
                    {m.film_index}:{m.substrate_index}
                  </td>
                  <td>
                    {fmtNum(m.f_u_pct)}, {fmtNum(m.f_v_pct)}
                  </td>
                  <td>{fmtNum(m.rotation)}</td>
                  <td>
                    {dirText(m.film_direction, m.film_direction_4)} ∥ {dirText(m.substrate_direction, m.substrate_direction_4)}
                  </td>
                  <td>{fmtNum(m.area)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
