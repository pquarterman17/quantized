// Calculators ▸ Substrates — labeled critical-thickness extensions beside the
// MATLAB-parity Matthews-Blakeslee card: People & Bean (APL 47, 322 (1985)) and
// Matthews & Blakeslee (J. Cryst. Growth 27, 118 (1974)) with a user-given slip
// system. Every material parameter is an input; the slip-system defaults
// (60°/60°, b = a_film/√2) merely reproduce the parity card. Lazy-loaded by
// SubstratesTab. Provisional, owner to confirm: ν limited to [0, 0.5].

import { useEffect, useState } from "react";

import { criticalThicknessModel, type CtModel } from "../../../lib/api/growth";
import { Button, Card, dual, Field, ROW, resultLine, useCard, withTouch } from "./shared";

const LABELS: Record<CtModel, string> = {
  matthews_blakeslee: "Matthews & Blakeslee, J. Cryst. Growth 27, 118 (1974)",
  people_bean: "People & Bean, Appl. Phys. Lett. 47, 322 (1985)",
};

export default function CriticalThicknessModelsCard({ aFilm, aSub }: { aFilm: string; aSub: number }) {
  const [model, setModel] = useState<CtModel>("people_bean");
  const [nu, setNu] = useState("0.3");
  const [b, setB] = useState("");
  const [alpha, setAlpha] = useState("60");
  const [lambda, setLambda] = useState("60");
  const c = useCard("Substrates");
  const mb = model === "matthews_blakeslee";
  const { touch } = c;
  // A changed film or substrate lattice parameter invalidates a shown result.
  useEffect(() => touch(), [aFilm, aSub, touch]);

  return (
    <Card title="Critical thickness: further models">
      <div style={ROW}>
        <select
          className="qz-select"
          aria-label="critical thickness model"
          value={model}
          onChange={(e) => {
            setModel(e.target.value as CtModel);
            c.touch();
          }}
        >
          <option value="people_bean">People-Bean</option>
          <option value="matthews_blakeslee">Matthews-Blakeslee (slip system)</option>
        </select>
        <Field label="ν" ariaLabel="Poisson ratio (model)" value={nu} onChange={withTouch(c.touch, setNu)} width={56} />
        <Field label="b" ariaLabel="Burgers vector" value={b} onChange={withTouch(c.touch, setB)} unit="Å" width={64} />
        {mb && (
          <>
            <Field label="α" ariaLabel="alpha" value={alpha} onChange={withTouch(c.touch, setAlpha)} unit="°" width={56} />
            <Field label="λ" ariaLabel="lambda" value={lambda} onChange={withTouch(c.touch, setLambda)} unit="°" width={56} />
          </>
        )}
        <Button
          variant="primary"
          size="sm"
          onClick={() =>
            void c.run(
              LABELS[model],
              `a_film=${aFilm} Å, a_sub=${aSub} Å, ν=${nu}, b=${b || "a/√2"}${mb ? `, α=${alpha}°, λ=${lambda}°` : ""}`,
              async () => {
                const af = Number(aFilm);
                if (!Number.isFinite(af) || af <= 0) throw new Error("a_film must be a positive number");
                const bv = b.trim() === "" ? null : Number(b);
                const r = await criticalThicknessModel({
                  model,
                  a_film: af,
                  a_sub: aSub,
                  nu: Number(nu),
                  b: bv,
                  alpha_deg: Number(alpha),
                  lambda_deg: Number(lambda),
                });
                if (r.matched) return dual`h_c = ∞ (lattice matched)`;
                return dual`h_c = ${r.h_c as number} Å = ${r.h_c_nm as number} nm  [${r.label}]`;
              },
            )
          }
        >
          Calculate h_c
        </Button>
      </div>
      <div className="qzk-ds-meta" style={{ marginTop: 6 }}>
        {LABELS[model]}. Blank b uses a_film/√2 (the parity card&apos;s assumption); enter the Burgers
        vector of your slip system. Extension to the parity model above, which is unchanged.
      </div>
      {resultLine(c.result)}
    </Card>
  );
}
