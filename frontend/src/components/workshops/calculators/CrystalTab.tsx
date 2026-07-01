// Calculators ▸ Crystal tab — interplanar d-spacing (all 7 systems) + unit-cell
// volume & theoretical density (calc.crystallography + calc.formula).
// Presentational; state in useCalculators.

import { Button, NumberField, Select } from "../../primitives";
import { fmtNum } from "../../../lib/format";
import { CRYSTAL_SYSTEMS, type CalculatorsState, type CellAngle } from "./useCalculators";

const ANGLE_GLYPH: Record<CellAngle, string> = { alpha: "α", beta: "β", gamma: "γ" };

export default function CrystalTab({ c }: { c: CalculatorsState }) {
  const spec = CRYSTAL_SYSTEMS.find((s) => s.value === c.crystal.system);
  const lengths = spec?.lengths ?? [];
  const angles = spec?.angles ?? [];
  return (
    <div style={{ marginTop: 12 }}>
      <Select
        options={CRYSTAL_SYSTEMS.map((s) => ({ value: s.value, label: s.label }))}
        value={c.crystal.system}
        onChange={(e) => c.updCrystal({ system: e.target.value })}
        aria-label="crystal system"
      />

      {/* Lattice lengths (a always; b/c per system) */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        <span className="qzk-field-lbl" style={{ margin: 0 }}>
          a
        </span>
        <NumberField value={c.crystal.a} width={64} onChange={(v) => c.updCrystal({ a: v })} />
        {lengths.includes("b") && (
          <>
            <span className="qzk-field-lbl" style={{ margin: 0 }}>
              b
            </span>
            <NumberField value={c.crystal.b} width={64} onChange={(v) => c.updCrystal({ b: v })} />
          </>
        )}
        {lengths.includes("c") && (
          <>
            <span className="qzk-field-lbl" style={{ margin: 0 }}>
              c
            </span>
            <NumberField value={c.crystal.c} width={64} onChange={(v) => c.updCrystal({ c: v })} />
          </>
        )}
        <span style={{ color: "var(--text-faint)" }}>Å</span>
      </div>

      {/* Lattice angles (only for low-symmetry systems) */}
      {angles.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          {angles.map((ang) => (
            <span key={ang} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span className="qzk-field-lbl" style={{ margin: 0 }}>
                {ANGLE_GLYPH[ang]}
              </span>
              <NumberField
                value={c.crystal[ang]}
                width={64}
                onChange={(v) => c.updCrystal({ [ang]: v })}
              />
            </span>
          ))}
          <span style={{ color: "var(--text-faint)" }}>°</span>
        </div>
      )}

      {/* d-spacing from Miller indices */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
        <span className="qzk-field-lbl" style={{ margin: 0 }}>
          hkl
        </span>
        <NumberField value={c.crystal.h} width={44} onChange={(v) => c.updCrystal({ h: v })} />
        <NumberField value={c.crystal.k} width={44} onChange={(v) => c.updCrystal({ k: v })} />
        <NumberField value={c.crystal.l} width={44} onChange={(v) => c.updCrystal({ l: v })} />
        <Button variant="primary" size="sm" disabled={c.crBusy} onClick={() => void c.crCompute()}>
          =
        </Button>
      </div>
      {c.crResult && !c.crError && (
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-lg)" }}>
            d = {fmtNum(c.crResult.d)} <span style={{ color: "var(--text-dim)" }}>Å</span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={c.sendDToXray}
            title="Use this d in the X-ray tab (d → 2θ → Q)"
          >
            → X-ray
          </Button>
        </div>
      )}
      {c.crError && (
        <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--danger)" }}>
          {c.crError}
        </div>
      )}

      {/* Cell volume + theoretical density (shares the lattice above) */}
      <div className="qzk-field-lbl" style={{ marginTop: 16 }}>
        Cell volume &amp; density
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
        <span className="qzk-field-lbl" style={{ margin: 0 }}>
          formula
        </span>
        <NumberField
          numeric={false}
          value={c.crystal.formula}
          width={92}
          onChange={(v) => c.updCrystal({ formula: v })}
          aria-label="chemical formula"
        />
        <span className="qzk-field-lbl" style={{ margin: 0 }}>
          Z
        </span>
        <NumberField value={c.crystal.z} width={44} onChange={(v) => c.updCrystal({ z: v })} />
        <Button variant="primary" size="sm" disabled={c.cellBusy} onClick={() => void c.cellCompute()}>
          =
        </Button>
      </div>
      {c.cellResult && !c.cellError && (
        <div style={{ marginTop: 10, fontFamily: "var(--font-mono)" }}>
          <div style={{ fontSize: "var(--font-size-lg)" }}>
            V = {fmtNum(c.cellResult.volume)} <span style={{ color: "var(--text-dim)" }}>Å³</span>
          </div>
          {c.cellResult.density != null && (
            <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ color: "var(--text-dim)" }}>
                ρ = {fmtNum(c.cellResult.density)} g/cm³
                {c.cellResult.molar_mass != null && (
                  <> · M = {fmtNum(c.cellResult.molar_mass)} g/mol</>
                )}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={c.sendCellToSld}
                title="Use this formula + theoretical density in the SLD tab"
              >
                → SLD
              </Button>
            </div>
          )}
        </div>
      )}
      {c.cellError && (
        <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--danger)" }}>
          {c.cellError}
        </div>
      )}
    </div>
  );
}
