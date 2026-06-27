// Calculators ▸ Constants tab — CODATA physical constants (golden calc.constants),
// loaded by the useCalculators hook on mount.

import { DataTable } from "../../primitives";
import { fmtNum } from "../../../lib/format";
import { type CalculatorsState } from "./useCalculators";

export default function ConstantsTab({ c }: { c: CalculatorsState }) {
  return (
    <div style={{ marginTop: 12 }}>
      {c.constants ? (
        <DataTable
          columns={["constant", "value (SI)"]}
          rows={Object.entries(c.constants).map(([k, v]) => [
            k,
            <span key={k} style={{ fontFamily: "var(--font-mono)" }}>
              {fmtNum(v)}
            </span>,
          ])}
        />
      ) : (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          Constants unavailable (backend offline).
        </div>
      )}
    </div>
  );
}
