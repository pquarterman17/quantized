// The manager's two inline editors: Rename (a new name; the formulas that read the range follow it) and Retarget (a new
// worksheet, columns and rows for the same name). Both apply through the store writers, which validate and refuse with a
// reason; the editor shows that reason and stays open, so nothing is ever repaired by guessing.

import { useState } from "react";

import type { NamedRange } from "../../../lib/namedRanges";
import type { Dataset } from "../../../lib/types";
import { renameNamedRange, retargetNamedRange } from "../../../store/namedRanges";
import { columnSpecText, parseColumnSpec, parseRowSpec } from "./rangeSpec";

interface EditorProps {
  range: NamedRange;
  onDone: () => void;
}

export function RenameEditor({ range, onDone }: EditorProps) {
  const [name, setName] = useState(range.name);
  const [error, setError] = useState<string | null>(null);
  const apply = (): void => {
    const result = renameNamedRange(range.id, name);
    if (result.ok) onDone();
    else setError(result.reason);
  };
  return (
    <div className="qzk-nr-editor">
      <input
        className="qz-input"
        aria-label={`New name for ${range.name}`}
        value={name}
        autoFocus
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") apply();
          else if (e.key === "Escape") onDone();
        }}
      />
      <button className="qz-btn" onClick={apply}>Rename</button>
      <button className="qz-btn" onClick={onDone}>Cancel</button>
      {error && <span className="qzk-ds-meta qzk-nr-warn" role="alert">{error}</span>}
    </div>
  );
}

interface RetargetProps extends EditorProps {
  /** Worksheets the range may move to: its own, or the sheets of its workbook for a workbook-scoped name. */
  sheets: readonly Dataset[];
}

export function RetargetEditor({ range, sheets, onDone }: RetargetProps) {
  const [sheetId, setSheetId] = useState(range.target.datasetId);
  const [cols, setCols] = useState(columnSpecText(range.target.cols));
  const rows = range.target.rows && range.target.rows.was === undefined ? range.target.rows : null;
  const [from, setFrom] = useState(rows ? String(rows.from + 1) : "");
  const [to, setTo] = useState(rows ? String(rows.to + 1) : "");
  const [error, setError] = useState<string | null>(null);
  const sheet = sheets.find((d) => d.id === sheetId) ?? sheets[0];

  const apply = (): void => {
    if (!sheet) return setError("the worksheet no longer exists");
    const c = parseColumnSpec(cols, sheet.data.labels.length);
    if ("reason" in c) return setError(c.reason);
    const r = parseRowSpec(from, to);
    if ("reason" in r) return setError(r.reason);
    const result = retargetNamedRange(range.id, { datasetId: sheet.id, cols: c.cols, rows: r.rows });
    if (result.ok) onDone();
    else setError(result.reason);
  };
  const edited = (set: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    set(e.target.value);
    setError(null);
  };
  return (
    <div className="qzk-nr-editor">
      {sheets.length > 1 && (
        <select className="qz-select" aria-label="Worksheet" value={sheetId} onChange={edited(setSheetId)}>
          {sheets.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      )}
      <label>Columns <input className="qz-input" aria-label="Columns" style={{ width: 90 }} value={cols} placeholder="B:C" title="Column letters such as B:C or A, C (a lone x is the x column)" onChange={edited(setCols)} /></label>
      <label>Rows <input className="qz-input" aria-label="First row" style={{ width: 64 }} inputMode="numeric" value={from} placeholder="first" onChange={edited(setFrom)} /></label>
      <label>to <input className="qz-input" aria-label="Last row" style={{ width: 64 }} inputMode="numeric" value={to} placeholder="last" onChange={edited(setTo)} /></label>
      <button className="qz-btn" onClick={apply}>Retarget</button>
      <button className="qz-btn" onClick={onDone}>Cancel</button>
      <span className="qzk-ds-meta">Both rows blank = every row (1-based).</span>
      {error && <span className="qzk-ds-meta qzk-nr-warn" role="alert">{error}</span>}
    </div>
  );
}
