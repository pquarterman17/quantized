// Calculators ▸ Substrates: the selected row's material record, field by field,
// with each value's unit and source (OPEN_ITEMS row 28). Lazy-loaded from
// SubstratesTab. A field the record does not hold is listed as "not stored",
// never filled in.

import type { CitedValue, MaterialRecordWire } from "../../../lib/api/substrates";
import { fmtNum } from "../../../lib/format";

type Row = [label: string, value: string | null, source: string | null];

const ELASTIC_LABELS: [keyof MaterialRecordWire["elastic"], string][] = [
  ["c11", "C11"],
  ["c12", "C12"],
  ["c13", "C13"],
  ["c33", "C33"],
  ["c44", "C44"],
  ["c66", "C66"],
  ["youngs_modulus", "E"],
  ["poisson_ratio", "ν"],
];

function cited(label: string, v: CitedValue | null): Row {
  if (v == null) return [label, null, null];
  return [label, `${fmtNum(v.value)}${v.unit ? ` ${v.unit}` : ""}`, v.source];
}

export default function MaterialSources({ record }: { record: MaterialRecordWire }) {
  const cell = record.lattice;
  const rows: Row[] = [
    ["System", record.system, null],
    [
      "Cell",
      cell
        ? `${fmtNum(cell.a)}, ${fmtNum(cell.b)}, ${fmtNum(cell.c)} Å; ` +
          `${fmtNum(cell.alpha)}, ${fmtNum(cell.beta)}, ${fmtNum(cell.gamma)}°`
        : null,
      record.lattice_source,
    ],
    ["Centering", record.centering, record.centering_source],
    ["Space group", record.space_group, record.space_group_source],
    cited("CTE", record.cte),
    cited("Density", record.density),
    cited("ε_r", record.dielectric_constant),
    ...ELASTIC_LABELS.map(([k, label]) => cited(label, record.elastic[k])),
  ];
  return (
    <details style={{ marginTop: 6 }} aria-label="material record sources">
      <summary className="qzk-field-lbl">Material record and sources</summary>
      <table className="qzk-ds-meta" style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          {rows.map(([label, value, source]) => (
            <tr key={label}>
              <td style={{ paddingRight: 8, verticalAlign: "top", whiteSpace: "nowrap" }}>{label}</td>
              <td style={{ fontFamily: "var(--font-mono)", verticalAlign: "top", paddingRight: 8, overflowWrap: "anywhere" }}>
                {value ?? <span style={{ color: "var(--text-faint)" }}>not stored</span>}
              </td>
              <td style={{ color: "var(--text-faint)", verticalAlign: "top", overflowWrap: "anywhere" }}>{source ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
