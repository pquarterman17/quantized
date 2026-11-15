// A table layer's cells in Layer properties (origin gap audit 3 #15): typed
// (one row per line, tab- or comma-separated), or filled from a worksheet's
// rows — a snapshot of those cells, which the user can then edit.

import { useState } from "react";

import { tableFromRows, tableText } from "../../../lib/graphLayers";
import type { LayerDraft } from "../../../lib/graphLayerDraft";
import type { Dataset } from "../../../lib/types";

export default function TableLayerFields({
  draft,
  datasets,
  activeId,
  onChange,
}: {
  draft: LayerDraft;
  datasets: readonly Dataset[];
  activeId: string | null;
  onChange: (patch: Partial<LayerDraft>) => void;
}) {
  const sheets = datasets.filter((d) => d.data.time.length > 0);
  const [from, setFrom] = useState(() => (sheets.some((d) => d.id === activeId) ? activeId! : (sheets[0]?.id ?? "")));
  const [first, setFirst] = useState("1");
  const [last, setLast] = useState("5");
  const [names, setNames] = useState(true);
  const ds = sheets.find((d) => d.id === from);
  const rowsOk = ds && Number.isInteger(Number(first)) && Number.isInteger(Number(last)) && Number(first) >= 1 && Number(last) >= 1;
  const fill = () => {
    if (!ds || !rowsOk) return;
    onChange({ cells: tableText(tableFromRows(ds, Number(first), Number(last), names)), header: names });
  };
  const num = { width: 64 } as const;

  return (
    <>
      <label className="qzk-field-lbl" style={{ display: "grid", gap: 2 }}>
        <span>Cells — one row per line, cells separated by tabs or commas</span>
        <textarea className="qz-input" aria-label="Table cells" rows={6} value={draft.cells}
          style={{ fontFamily: "var(--font-mono)", resize: "vertical" }}
          onChange={(e) => onChange({ cells: e.target.value })} />
      </label>
      <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input type="checkbox" checked={draft.header} onChange={(e) => onChange({ header: e.target.checked })} />
        First row is a header (bold)
      </label>
      {sheets.length > 0 && (
        <fieldset style={{ border: "1px solid var(--border)", borderRadius: 4, padding: 6, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <legend>Fill from worksheet rows</legend>
          <select className="qz-select" aria-label="Worksheet" value={from} onChange={(e) => setFrom(e.target.value)}>
            {sheets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <label>Rows <input className="qz-input qz-num" style={num} aria-label="First row" value={first} onChange={(e) => setFirst(e.target.value)} /></label>
          <label>to <input className="qz-input qz-num" style={num} aria-label="Last row" value={last} onChange={(e) => setLast(e.target.value)} /></label>
          <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} /> Column names
          </label>
          <button type="button" className="qz-btn" disabled={!rowsOk} onClick={fill}>Fill</button>
        </fieldset>
      )}
    </>
  );
}
