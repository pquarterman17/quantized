// Thin Film ▸ Bauer growth-mode card (Bauer, Z. Kristallogr. 110, 372 (1958)).
// delta = γ_film + γ_int − γ_substrate: delta < 0 wets (Frank-van der Merwe),
// delta > 0 islands (Volmer-Weber); Stranski-Krastanov needs the optional
// strain term. γ_int is scanned over a user range (it is rarely known) and no
// surface energy is preloaded (data source is owner decision D2). Verdicts are
// shown to 3 significant figures and an "indeterminate" band follows the
// user's ± so the card never implies more precision than the inputs.
// Lazy-loaded by ThinFilmTab. Provisional, owner to confirm: the one-number SK model.

import { useState } from "react";

import { bauerScan, type BauerResult } from "../../../../lib/api/growth";
import { Button, Card, Field, ROW, resultLine, useCard, withTouch } from "../shared";

const sig3 = (x: number): string => Number(x.toPrecision(3)).toString();

export default function BauerCard() {
  const [gs, setGs] = useState("");
  const [gf, setGf] = useState("");
  const [lo, setLo] = useState("0");
  const [hi, setHi] = useState("");
  const [n, setN] = useState("9");
  const [u, setU] = useState("0");
  const [pen, setPen] = useState("0");
  const [scan, setScan] = useState<BauerResult | null>(null);
  const c = useCard("Thin Film");
  const edit = (set: (v: string) => void) => (v: string) => {
    setScan(null);
    withTouch(c.touch, set)(v);
  };

  return (
    <Card title="Growth mode (Bauer criterion)">
      <div style={ROW}>
        <Field label="γ_sub" ariaLabel="gamma substrate" value={gs} onChange={edit(setGs)} width={64} />
        <Field label="γ_film" ariaLabel="gamma film" value={gf} onChange={edit(setGf)} width={64} />
        <Field label="γ_int from" ariaLabel="gamma int min" value={lo} onChange={edit(setLo)} width={64} />
        <Field label="to" ariaLabel="gamma int max" value={hi} onChange={edit(setHi)} width={64} />
        <Field label="points" ariaLabel="points" value={n} onChange={edit(setN)} width={48} />
        <Field label="±" ariaLabel="uncertainty" value={u} onChange={edit(setU)} width={56} />
        <Field label="strain term" ariaLabel="strain term" value={pen} onChange={edit(setPen)} width={56} />
        <Button
          variant="primary"
          size="sm"
          onClick={() =>
            void c.run(
              "Bauer growth mode",
              `γ_sub=${gs}, γ_film=${gf}, γ_int ${lo}..${hi} (${n} pts), ±${u}, strain ${pen}`,
              async () => {
                const r = await bauerScan({
                  gamma_substrate: Number(gs),
                  gamma_film: Number(gf),
                  gamma_int_min: Number(lo),
                  gamma_int_max: Number(hi),
                  n: Number(n),
                  uncertainty: Number(u),
                  strain_penalty: Number(pen),
                });
                setScan(r);
                const vw = r.boundaries[0].gamma_int;
                const txt = `Volmer-Weber above γ_int ≈ ${sig3(vw)} (= γ_sub − γ_film); same unit as the inputs`;
                return { text: txt, copyValue: txt };
              },
            )
          }
        >
          Scan γ_int
        </Button>
      </div>
      <div className="qzk-ds-meta" style={{ marginTop: 6 }}>
        Enter all energies in one unit (e.g. J/m²); nothing is looked up. Δ = γ_film + γ_int − γ_sub.
        ± is the combined uncertainty on Δ: points within it of a boundary are reported indeterminate.
        A strain term &gt; 0 (Δ rise at large thickness) is needed for Stranski-Krastanov; 0 never shows it.
      </div>
      {resultLine(c.result)}
      {scan && (
        <table aria-label="Bauer verdicts" style={{ marginTop: 8, borderCollapse: "collapse", fontSize: "var(--font-size-sm)" }}>
          <thead>
            <tr>
              <th>γ_int</th>
              <th>Δ</th>
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {scan.points.map((p) => (
              <tr key={p.gamma_int}>
                <td>{sig3(p.gamma_int)}</td>
                <td>{sig3(p.delta)}</td>
                <td>{scan.verdict_labels[p.verdict]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
