// The column list view (plan item 34): every column of one worksheet on one page, with the name,
// unit and designation editable in place. A rename goes through the header editor's own setter and a
// designation through Set As, so each is one undo step and a protected sheet refuses a rename with
// its reason. Picking a row selects that column in the worksheet's grid (the Go to Source request).

import { useMemo, useState } from "react";

import { columnListRows, type ColumnListRow } from "../../../lib/columnList";
import type { OriginDesignation } from "../../../lib/columnmeta";
import { SET_AS_CHOICES } from "../../../lib/setAsChoices";
import { setColumnDesignation } from "../../../store/columnDesignationActions";
import { useApp } from "../../../store/useApp";
import { openedWorksheetWindowId, openWorksheet } from "../../../store/worksheetOpen";
import { useWorksheetReveal } from "../../../store/worksheetReveal";
import { setColumnHeader } from "../../../store/worksheetColumns";
import ToolWindowFrame from "../../overlays/ToolWindowFrame";
import "./sheetStructure.css";

/** Select column `col` of worksheet `id` in its grid (the window or tab that shows it). */
export function selectColumnInGrid(id: string, col: number): void {
  openWorksheet({ datasetId: id });
  useWorksheetReveal.getState().requestRowReveal({
    datasetId: id,
    row: -1,
    column: col,
    selectColumn: true,
    select: false,
    windowId: openedWorksheetWindowId(id),
  });
}

/** A text field that commits on Enter or blur and drops its draft on Escape or when the sheet changes under it. */
function CommitInput({ value, label, onCommit }: { value: string; label: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  // Resync during render when the sheet's value changes, not in an effect: a mount-time effect lands
  // after the first paint and would overwrite whatever the user had already typed (and is a no-op anyway).
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }
  const commit = () => {
    if (draft !== value) onCommit(draft);
    else setDraft(value);
  };
  return (
    <input
      className="qz-input"
      aria-label={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setDraft(value);
      }}
    />
  );
}

function Row({ row, id, selected, onPick }: { row: ColumnListRow; id: string; selected: boolean; onPick: () => void }) {
  const tag = row.letter;
  return (
    <tr aria-selected={selected} onClick={onPick}>
      <td>{tag}</td>
      <td>
        <CommitInput label={`Name, column ${tag}`} value={row.name} onCommit={(v) => v.trim() && setColumnHeader(id, row.col, { label: v })} />
      </td>
      <td>
        <CommitInput label={`Unit, column ${tag}`} value={row.unit} onCommit={(v) => setColumnHeader(id, row.col, { unit: v })} />
      </td>
      <td>
        <select
          className="qz-select"
          aria-label={`Designation, column ${tag}`}
          value={row.designation}
          disabled={row.col < 0}
          onChange={(e) => setColumnDesignation(id, row.col, e.target.value as OriginDesignation)}
        >
          {SET_AS_CHOICES.map(([d, label]) => (
            <option key={d} value={d}>
              {label}
            </option>
          ))}
          {!SET_AS_CHOICES.some(([d]) => d === row.designation) && <option value={row.designation}>{row.designation}</option>}
        </select>
      </td>
      <td>{row.type}</td>
      <td>{row.formula ? "yes" : "no"}</td>
      <td className="qzk-ss-num" title={`${row.filled} of ${row.rows} rows have a value`}>
        {row.filled === row.rows ? row.rows : `${row.filled} of ${row.rows}`}
      </td>
    </tr>
  );
}

export default function ColumnList({ datasetId, onClose }: { datasetId: string; onClose: () => void }) {
  const ds = useApp((s) => s.datasets.find((d) => d.id === datasetId));
  const rows = useMemo(() => (ds ? columnListRows(ds) : []), [ds]);
  const [picked, setPicked] = useState<number | null>(null);
  return (
    <ToolWindowFrame id="column-list" title={`Columns of ${ds?.name ?? "(deleted worksheet)"}`} width={720} onClose={onClose}>
      {!ds ? (
        <p className="qzk-ds-meta">This worksheet no longer exists.</p>
      ) : (
        <>
          {ds.protectedSheet && <p className="qzk-ds-meta">This sheet is protected: names and units cannot be changed until you unprotect it.</p>}
          <table className="qzk-ss-table" aria-label="Columns">
            <thead>
              <tr>
                <th>Col</th>
                <th>Name</th>
                <th>Unit</th>
                <th>Designation</th>
                <th>Type</th>
                <th>Formula</th>
                <th>Rows</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Row
                  key={row.col}
                  row={row}
                  id={ds.id}
                  selected={picked === row.col}
                  onPick={() => {
                    setPicked(row.col);
                    selectColumnInGrid(ds.id, row.col);
                  }}
                />
              ))}
            </tbody>
          </table>
        </>
      )}
    </ToolWindowFrame>
  );
}
