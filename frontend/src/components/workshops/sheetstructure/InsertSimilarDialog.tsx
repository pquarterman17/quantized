// Insert one column into every similar sheet (plan item 34). The sheets it will change are listed
// BEFORE Apply, each with a check box, and the similar sheets that cannot take it are listed with why.
// "Similar" is lib/similarSheets.ts's rule (the same data-column labels in the same order); the write is
// store/insertSimilar.ts (one undo step, all or nothing).

import { useMemo, useState } from "react";

import type { OriginDesignation } from "../../../lib/columnmeta";
import { SET_AS_CHOICES } from "../../../lib/setAsChoices";
import { baseLabels, similarSheets } from "../../../lib/similarSheets";
import { insertIntoSimilar } from "../../../store/insertSimilar";
import { useApp } from "../../../store/useApp";
import ToolWindowFrame from "../../overlays/ToolWindowFrame";
import "./sheetStructure.css";

export default function InsertSimilarDialog({ datasetId, onClose }: { datasetId: string; onClose: () => void }) {
  const datasets = useApp((s) => s.datasets);
  const active = datasets.find((d) => d.id === datasetId);
  const found = useMemo(() => (active ? similarSheets(datasets, active) : null), [datasets, active]);
  const [name, setName] = useState("");
  const [expr, setExpr] = useState("");
  const [designation, setDesignation] = useState<OriginDesignation>("Y");
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  if (!active || !found) return null;
  const chosen = found.targets.filter((d) => !unchecked.has(d.id));
  const apply = () => {
    const r = insertIntoSimilar(chosen.map((d) => d.id), { name, expr, designation });
    if (r.ok) onClose();
    else setErr(r.error);
  };
  return (
    <ToolWindowFrame id="insert-column-similar" title="Insert a column into similar sheets" width={520} onClose={onClose}>
      <div className="qzk-ss-form">
        <p className="qzk-ds-meta">
          Similar to {active.name}: the same columns ({baseLabels(active).join(", ") || "none"}) in the same order.
        </p>
        <label className="qzk-ss-row">
          Name
          <input className="qz-input" aria-label="Column name" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="qzk-ss-row">
          Formula (blank for an empty column)
          <input className="qz-input" aria-label="Column formula" value={expr} onChange={(e) => setExpr(e.target.value)} />
        </label>
        <label className="qzk-ss-row">
          Designation
          <select className="qz-select" aria-label="Column designation" value={designation} onChange={(e) => setDesignation(e.target.value as OriginDesignation)}>
            {SET_AS_CHOICES.filter(([d]) => d !== "X").map(([d, label]) => (
              <option key={d} value={d}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="qzk-ss-form">
          <legend>Sheets that will change ({chosen.length})</legend>
          <ul className="qzk-ss-list" aria-label="Sheets that will change">
            {found.targets.map((d) => (
              <li key={d.id}>
                <label>
                  <input
                    type="checkbox"
                    aria-label={`Include ${d.name}`}
                    checked={!unchecked.has(d.id)}
                    onChange={(e) => setUnchecked((u) => new Set(e.target.checked ? [...u].filter((x) => x !== d.id) : [...u, d.id]))}
                  />{" "}
                  {d.name}
                  {d.id === active.id ? " (this sheet)" : ""}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        {found.refused.length > 0 && (
          <div>
            <p className="qzk-ds-meta">Similar, but cannot take the column:</p>
            <ul className="qzk-ss-list" aria-label="Sheets that cannot change">
              {found.refused.map(({ ds, reason }) => (
                <li key={ds.id}>
                  {ds.name}: {reason}
                </li>
              ))}
            </ul>
          </div>
        )}
        {err && (
          <p className="qzk-ds-meta" role="alert" style={{ color: "var(--danger)" }}>
            {err}
          </p>
        )}
        <div className="qzk-ss-row">
          <button className="qz-btn qz-primary" disabled={chosen.length === 0 || !name.trim()} onClick={apply}>
            Insert into {chosen.length} sheet{chosen.length === 1 ? "" : "s"}
          </button>
          <button className="qz-btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </ToolWindowFrame>
  );
}
