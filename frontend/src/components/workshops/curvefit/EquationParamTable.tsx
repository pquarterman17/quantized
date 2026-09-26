// Guess / min / max / unit / hold table of a custom equation fit (GOTO #1;
// the hold and unit columns are audit P2.7, the hold mirroring
// FitParamsSection's for registry models). A held parameter keeps its guess
// through the fit and reports no standard error; a unit is display metadata
// saved with the model and shown beside the fitted value. Rows come from the
// last successful validate, in equation order.

import type { EquationParamRow } from "../../../lib/equationRows";
import { DataTable } from "../../primitives/DataTable";
import { NumberField } from "../../primitives/NumberField";

interface Props {
  rows: readonly EquationParamRow[];
  setRow: (
    index: number,
    field: "guess" | "min" | "max" | "unit",
    value: string,
  ) => void;
  setHeld: (index: number, held: boolean) => void;
}

export default function EquationParamTable({ rows, setRow, setHeld }: Props) {
  return (
    <div className="qzk-dense-table">
      <DataTable
        columns={["param", "guess", "min", "max", "unit", "hold"]}
        rows={rows.map((r, i) => [
          <span key="n" style={{ fontFamily: "var(--font-mono)" }}>
            {r.name}
          </span>,
          <NumberField
            key="g"
            width={56}
            value={r.guess}
            onChange={(v) => setRow(i, "guess", v)}
            aria-label={`guess ${r.name}`}
          />,
          <NumberField
            key="lo"
            width={56}
            value={r.min}
            placeholder="−∞"
            onChange={(v) => setRow(i, "min", v)}
            aria-label={`min ${r.name}`}
          />,
          <NumberField
            key="hi"
            width={56}
            value={r.max}
            placeholder="+∞"
            onChange={(v) => setRow(i, "max", v)}
            aria-label={`max ${r.name}`}
          />,
          <NumberField
            key="u"
            width={40}
            numeric={false}
            value={r.unit}
            placeholder="—"
            title="Unit of this parameter (saved with the model, shown beside the fitted value)"
            onChange={(v) => setRow(i, "unit", v)}
            aria-label={`unit ${r.name}`}
          />,
          <input
            key="h"
            type="checkbox"
            checked={r.fixed}
            aria-label={`Hold ${r.name} fixed`}
            title="Hold this parameter at its guess instead of fitting it"
            onChange={(e) => setHeld(i, e.target.checked)}
          />,
        ])}
      />
    </div>
  );
}
