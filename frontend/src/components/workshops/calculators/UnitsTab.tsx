// Calculators ▸ Units tab — unit-expression converter with quick-pick chips.
// Presentational; all state/logic is in the useCalculators hook (math is golden
// in calc.unit_convert). Extracted from CalculatorsPanel to keep it a thin shell.

import { Button, NumberField, Pill } from "../../primitives";
import { fmtNum } from "../../../lib/format";
import { QUICK_PAIRS, type CalculatorsState } from "./useCalculators";

export default function UnitsTab({ c }: { c: CalculatorsState }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <NumberField value={c.value} width={84} onChange={c.setValue} />
        <input
          className="qz-input"
          style={{ width: 64 }}
          value={c.from}
          onChange={(e) => c.setFrom(e.target.value)}
          aria-label="from unit"
        />
        <span style={{ color: "var(--text-faint)" }}>→</span>
        <input
          className="qz-input"
          style={{ width: 64 }}
          value={c.to}
          onChange={(e) => c.setTo(e.target.value)}
          aria-label="to unit"
        />
        <Button variant="primary" size="sm" disabled={c.busy} onClick={() => void c.convert()}>
          =
        </Button>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
        {QUICK_PAIRS.map((p) => (
          <Pill
            key={p.label}
            active={c.from === p.from && c.to === p.to}
            onClick={() => c.setPair(p.from, p.to)}
          >
            {p.label}
          </Pill>
        ))}
      </div>

      {c.result != null && !c.error && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-lg)" }}>
            {fmtNum(c.result)} <span style={{ color: "var(--text-dim)" }}>{c.to}</span>
          </div>
          {c.description && (
            <div className="qzk-ds-meta" style={{ marginTop: 4, color: "var(--text-faint)" }}>
              {c.description}
            </div>
          )}
        </div>
      )}
      {c.error && (
        <div className="qzk-ds-meta" style={{ marginTop: 12, color: "var(--danger)" }}>
          {c.error}
        </div>
      )}
    </div>
  );
}
