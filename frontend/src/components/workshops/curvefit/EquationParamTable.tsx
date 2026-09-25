// Guess / min / max / hold table of a custom equation fit (GOTO #1; the hold
// column is audit P2.7, mirroring FitParamsSection's for registry models). A
// held parameter keeps its guess through the fit and reports no standard
// error. Rows come from the last successful validate, in equation order.

import type { EquationParamRow } from "../../../lib/equationRows";
import { DataTable } from "../../primitives/DataTable";
import { NumberField } from "../../primitives/NumberField";

interface Props {
  rows: readonly EquationParamRow[];
  setRow: (index: number, field: "guess" | "min" | "max", value: string) => void;
  setHeld: (index: number, held: boolean) => void;
}

export default function EquationParamTable({ rows, setRow, setHeld }: Props) {
  return (
    <DataTable
      columns={["param", "guess", "min", "max", "hold"]}
      rows={rows.map((r, i) => [
        <span key="n" style={{ fontFamily: "var(--font-mono)" }}>
          {r.name}
        </span>,
        <NumberField
          key="g"
          width={60}
          value={r.guess}
          onChange={(v) => setRow(i, "guess", v)}
          aria-label={`guess ${r.name}`}
        />,
        <NumberField
          key="lo"
          width={60}
          value={r.min}
          placeholder="−∞"
          onChange={(v) => setRow(i, "min", v)}
          aria-label={`min ${r.name}`}
        />,
        <NumberField
          key="hi"
          width={60}
          value={r.max}
          placeholder="+∞"
          onChange={(v) => setRow(i, "max", v)}
          aria-label={`max ${r.name}`}
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
  );
}
