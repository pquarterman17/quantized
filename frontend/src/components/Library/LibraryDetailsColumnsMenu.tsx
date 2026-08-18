// PR L (L0.56) — the Details view's "selectable metadata columns" picker: a
// plain disclosure button + checkbox list. Split out of LibraryDetails.tsx
// purely for the component-ceiling ratchet (architecture.test.ts) — this
// file owns no state of its own, LibraryDetails.tsx still owns
// `visibleColumns`/`columnsMenuOpen` (session-local, not yet .dwk-persisted;
// see that file's header).

import { LIBRARY_DETAILS_COLUMNS, type LibraryDetailsColumnKey } from "../../lib/libraryDetailsColumns";

interface Props {
  open: boolean;
  visibleColumns: ReadonlySet<LibraryDetailsColumnKey>;
  onToggleOpen: () => void;
  onToggleColumn: (key: LibraryDetailsColumnKey) => void;
}

export default function LibraryDetailsColumnsMenu({ open, visibleColumns, onToggleOpen, onToggleColumn }: Props) {
  return (
    <div className="qzk-details-colpicker">
      <button
        type="button"
        className="qzk-details-manual"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={onToggleOpen}
      >
        Columns ▾
      </button>
      {open && (
        <div className="qzk-details-colmenu" role="menu" aria-label="Choose Details columns">
          {LIBRARY_DETAILS_COLUMNS.map((col) => (
            <label key={col.key} className="qzk-details-colitem">
              <input type="checkbox" checked={visibleColumns.has(col.key)} onChange={() => onToggleColumn(col.key)} />
              {col.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
