// Calculators ▸ Substrates — orientation-aware mismatch (plan G1 core,
// calc.surface_net). Unlike the scalar a_film/a_sub card above it, this one
// compares the in-plane lattices ("surface nets") of a film plane and a
// substrate plane, including Bravais centering, so Si(100) and Si(111) differ
// and Fe(001) on MgO(001) finds the 45°-rotated −3.7 % match. Both sides come
// from the reference phase table (it carries the centering the substrate
// table lacks). Supercell / rotation search is not done yet, and the card
// says so.

import { useState } from "react";

import { netMismatch, type PlaneSpec } from "../../../lib/api/epitaxy";
import type { PhaseInfo } from "../../../lib/api/reference";
import PhasePresetPicker from "../structures/PhasePresetPicker";
import { Button, Card, Field, ROW, dual, resultLine, useCard, withTouch } from "./shared";

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

export default function OrientedMismatchCard() {
  const [film, setFilm] = useState<PhaseInfo | null>(null);
  const [filmHkl, setFilmHkl] = useState("0 0 1");
  const [sub, setSub] = useState<PhaseInfo | null>(null);
  const [subHkl, setSubHkl] = useState("0 0 1");
  const card = useCard("Substrates");

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

  return (
    <Card title="Orientation-aware mismatch (surface nets)">
      <div style={ROW}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <PhasePresetPicker
            label="oriented film phase"
            selected={film?.name ?? ""}
            onApply={(_p, phase) => {
              setFilm(phase);
              card.touch();
            }}
          />
        </div>
        <Field label="(hkl)" ariaLabel="film plane" value={filmHkl} onChange={withTouch(card.touch, setFilmHkl)} numeric={false} width={72} />
      </div>
      <div style={{ ...ROW, marginTop: 6 }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <PhasePresetPicker
            label="oriented substrate phase"
            selected={sub?.name ?? ""}
            onApply={(_p, phase) => {
              setSub(phase);
              card.touch();
            }}
          />
        </div>
        <Field label="(hkl)" ariaLabel="substrate plane" value={subHkl} onChange={withTouch(card.touch, setSubHkl)} numeric={false} width={72} />
        <Button variant="primary" size="sm" onClick={run}>
          Compare
        </Button>
      </div>
      <div className="qzk-ds-meta" style={{ marginTop: 6 }}>
        Compares the reduced in-plane lattices, centering included, with their axes aligned. It does not yet
        search supercells or rotations, so a coincidence match such as GaN on c-plane sapphire (√3×√3 R30°,
        about +16 %) still reads as the direct −33 %.
      </div>
      {resultLine(card.result)}
    </Card>
  );
}
