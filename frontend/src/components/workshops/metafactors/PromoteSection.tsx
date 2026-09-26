// "Metadata → factors" — the PROMOTE tab: a metadata field, its type and the
// new column's name, and the plan previewed row by row (the value every row
// of each dataset gets; a dataset with none is listed, blank) before commit.

import { Button, Select } from "../../primitives";
import type { FactorAs } from "../../../lib/metadataFactor";
import { pathId } from "../../../lib/metadataKeys";
import type { MetaFactorsState } from "./useMetaFactors";

const gap = { marginTop: 8 };
const faint = { marginTop: 4, color: "var(--text-faint)" };

export default function PromoteSection({ m }: { m: MetaFactorsState }) {
  if (!m.picked.length) return <div className="qzk-ds-meta" style={{ ...gap, ...faint }}>Tick at least one dataset.</div>;
  if (!m.keys.length || !m.key) {
    return <div className="qzk-ds-meta" style={{ ...gap, ...faint }}>The picked datasets carry no single-value metadata fields.</div>;
  }
  const plan = m.plan;
  return (
    <>
      <label className="qzk-field-lbl" style={gap}>Metadata field</label>
      <Select
        aria-label="Metadata field"
        options={m.keys.map((k) => ({ value: pathId(k.path), label: `${k.label} (${k.ids.length}/${m.picked.length})` }))}
        value={pathId(m.key.path)}
        onChange={(e) => m.setKey(e.target.value)}
      />
      <label className="qzk-field-lbl" style={gap}>Column type</label>
      <Select
        aria-label="Column type"
        options={[
          { value: "auto", label: `Automatic (${plan?.as ?? "categorical"})` },
          { value: "categorical", label: "Categorical (text levels)" },
          { value: "numeric", label: "Numeric" },
        ]}
        value={m.as}
        onChange={(e) => m.setAs(e.target.value as FactorAs | "auto")}
      />
      <label className="qzk-field-lbl" style={gap} htmlFor="meta-factor-name">Column name</label>
      <input id="meta-factor-name" className="qz-input" value={m.columnName} onChange={(e) => m.setName(e.target.value)} />
      {plan && (
        <div className="qzk-dense-table" style={{ marginTop: 8, maxHeight: 200, overflow: "auto" }}>
          <table className="qz-table" aria-label="Factor preview">
            <thead>
              <tr>
                <th scope="col">Dataset</th>
                <th scope="col">Every row gets</th>
              </tr>
            </thead>
            <tbody>
              {plan.rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td style={{ fontFamily: "var(--font-mono)" }}>{r.value === undefined ? "(blank — no value)" : `${r.cell}${r.unit ? ` ${r.unit}` : ""}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {plan && plan.missing.length > 0 && (
        <div className="qzk-ds-meta" role="note" style={{ ...faint, color: "var(--warn)" }}>
          {`No value in ${plan.missing.join(", ")}: its rows are left blank, not filled in.`}
        </div>
      )}
      {plan?.blocked && (
        <div className="qzk-ds-meta" style={{ ...faint, color: "var(--danger)" }}>{plan.blocked}</div>
      )}
      <Button
        variant="primary"
        size="sm"
        disabled={!plan || !!plan.blocked || m.busy}
        onClick={() => void m.promote()}
        style={{ marginTop: 12, width: "100%" }}
      >
        {m.busy ? "Adding…" : "Add factor column"}
      </Button>
      <div className="qzk-ds-meta" style={faint}>
        A computed column after the existing ones; Ctrl+Z undoes it, and it is recorded as a pipeline step.
      </div>
    </>
  );
}
