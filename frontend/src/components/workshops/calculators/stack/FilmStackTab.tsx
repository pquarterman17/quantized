// Calculators ▸ Film stack (plan G4, calc.film_stack): build a layer stack on
// a substrate and see, per layer, the mismatch to the layer below, the
// Matthews–Blakeslee critical thickness, coherent vs relaxed, the in- and
// out-of-plane strain, the strained c with its (00L) 2θ, and the cool-down
// thermal strain. Cube-on-cube (001)-type stacks with isotropic elasticity
// (Poisson ratio) for now; the tab says so.

import { NumberField } from "../../../primitives/NumberField";
import PhasePresetPicker from "../../structures/PhasePresetPicker";
import { Button, Card, Field, ROW, resultLine } from "../shared";
import StackResults from "./StackResults";
import { useFilmStack } from "./useFilmStack";

const CELL = { padding: "2px 4px" } as const;

export default function FilmStackTab() {
  const s = useFilmStack();
  return (
    <div style={{ marginTop: 12 }}>
      <Card title="Substrate and conditions">
        <div style={ROW}>
          <Field label="a_sub" ariaLabel="substrate a" value={s.subA} onChange={s.setSubA} unit="Å" width={64} />
          <Field label="CTE" ariaLabel="substrate CTE" value={s.subCte} onChange={s.setSubCte} unit="10⁻⁶/K" width={52} />
          <Field label="T_growth" ariaLabel="growth temperature" value={s.growthT} onChange={s.setGrowthT} unit="K" width={56} />
          <Field label="λ" ariaLabel="wavelength" value={s.wavelength} onChange={s.setWavelength} unit="Å" width={64} />
          <Field label="RSM (H 0 L)" ariaLabel="RSM reflection" value={s.rsmHL} onChange={s.setRsmHL} numeric={false} width={48} />
          <Field label="substrate formula" ariaLabel="substrate formula" value={s.subFormula} onChange={s.setSubFormula} numeric={false} width={72} />
          <Field label="ρ_sub" ariaLabel="substrate density" value={s.subDensity} onChange={s.setSubDensity} unit="g/cm³" width={52} />
        </div>
      </Card>

      <Card title="Layers (bottom to top)">
        <table className="qz-table" aria-label="stack layers">
          <thead>
            <tr>
              <th>name</th>
              <th>a (Å)</th>
              <th>c (Å)</th>
              <th>t (nm)</th>
              <th>ν</th>
              <th>CTE</th>
              <th>formula</th>
              <th>ρ (g/cm³)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {s.layers.map((l, i) => (
              <tr key={l.id}>
                {(["name", "a", "c", "thickness", "nu", "cte", "formula", "density"] as const).map((k) => (
                  <td key={k} style={CELL}>
                    <NumberField
                      value={l[k]}
                      numeric={k !== "name" && k !== "formula"}
                      width={k === "name" || k === "formula" ? 96 : 56}
                      aria-label={`layer ${i + 1} ${k}`}
                      onChange={(v) => s.updateLayer(l.id, { [k]: v })}
                    />
                  </td>
                ))}
                <td style={CELL}>
                  <Button size="sm" variant="ghost" aria-label={`move layer ${i + 1} down`} disabled={i === 0} onClick={() => s.moveLayer(l.id, -1)}>
                    ↓
                  </Button>
                  <Button size="sm" variant="ghost" aria-label={`move layer ${i + 1} up`} disabled={i === s.layers.length - 1} onClick={() => s.moveLayer(l.id, 1)}>
                    ↑
                  </Button>
                  <Button size="sm" variant="ghost" aria-label={`remove layer ${i + 1}`} onClick={() => s.removeLayer(l.id)}>
                    ×
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ ...ROW, marginTop: 6 }}>
          <Button size="sm" onClick={() => s.addLayer()}>
            Add layer
          </Button>
          <div style={{ flex: 1, minWidth: 200 }}>
            <PhasePresetPicker label="add layer from phase" selected="" onApply={(_p, phase) => s.addPhase(phase)} />
          </div>
          <Button variant="primary" size="sm" onClick={s.run}>
            Evaluate stack
          </Button>
          <Button size="sm" onClick={() => void s.sendToReflectivity()}>
            → Reflectivity
          </Button>
        </div>
        <div className="qzk-helptext" style={{ marginTop: 6 }}>
          The first row sits on the substrate. Blank c means c = a. Each layer matches the in-plane lattice
          of the one below as grown (cube-on-cube, scalar a); a layer thicker than its Matthews–Blakeslee h_c
          is shown fully relaxed, a simple limit. h_c uses 60° dislocations with b = a/√2 (FCC-type slip), so
          for perovskites read it as an order of magnitude. Elasticity is isotropic (ν). CTE in 10⁻⁶/K; the
          thermal strain is the clamped film's on cooling to 300 K (a higher-CTE layer ends up tensile).
          → Reflectivity opens a new Parratt model (substrate last, nm → Å): an SLD is computed only from a
          layer's formula + density (X-ray at λ); with either blank it is left unset and flagged there.
          Interface roughness is not planned here, so it starts at the workshop's 3 Å and is marked to fit.
        </div>
        {resultLine(s.card.result)}
      </Card>

      {s.shown && <StackResults result={s.shown} />}
      {s.shown?.warnings.map((w) => (
        <div key={w} className="qzk-ds-meta" role="note" style={{ marginTop: 4, color: "var(--warn)" }}>
          ⚠ {w}
        </div>
      ))}
    </div>
  );
}
