// Calculators ▸ Crystal tab — interplanar d-spacing from lattice params + Miller
// indices (golden calc.crystallography). Presentational; state in useCalculators.

import { Button, NumberField, Select } from "../../primitives";
import { fmtNum } from "../../../lib/format";
import { CRYSTAL_SYSTEMS, type CalculatorsState } from "./useCalculators";

export default function CrystalTab({ c }: { c: CalculatorsState }) {
  const extra = CRYSTAL_SYSTEMS.find((s) => s.value === c.crystal.system)?.extra ?? [];
  return (
    <div style={{ marginTop: 12 }}>
      <Select
        options={CRYSTAL_SYSTEMS.map((s) => ({ value: s.value, label: s.label }))}
        value={c.crystal.system}
        onChange={(e) => c.updCrystal({ system: e.target.value })}
        aria-label="crystal system"
      />
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        <span className="qzk-field-lbl" style={{ margin: 0 }}>
          a
        </span>
        <NumberField value={c.crystal.a} width={64} onChange={(v) => c.updCrystal({ a: v })} />
        {extra.includes("b") && (
          <>
            <span className="qzk-field-lbl" style={{ margin: 0 }}>
              b
            </span>
            <NumberField value={c.crystal.b} width={64} onChange={(v) => c.updCrystal({ b: v })} />
          </>
        )}
        {extra.includes("c") && (
          <>
            <span className="qzk-field-lbl" style={{ margin: 0 }}>
              c
            </span>
            <NumberField value={c.crystal.c} width={64} onChange={(v) => c.updCrystal({ c: v })} />
          </>
        )}
        <span style={{ color: "var(--text-faint)" }}>Å</span>
      </div>
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
        <div style={{ marginTop: 12 }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-lg)" }}>
            d = {fmtNum(c.crResult.d)} <span style={{ color: "var(--text-dim)" }}>Å</span>
          </div>
        </div>
      )}
      {c.crError && (
        <div className="qzk-ds-meta" style={{ marginTop: 12, color: "var(--danger)" }}>
          {c.crError}
        </div>
      )}
    </div>
  );
}
