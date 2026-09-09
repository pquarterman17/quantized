// The Details table's sortable header row, lifted out of LibraryDetails.tsx
// (review round): the aria-rowcount/aria-rowindex work for the virtualized
// table pushed that file past the 400-line component ceiling, and the rule is
// to extract a cohesive sibling rather than shave the explanations that make
// the windowing legible. This is a self-contained unit — column labels, the
// sort affordance and its indicator, and the roving-tabindex header model —
// with no state of its own.

import type { LibraryDetailsSortKey } from "../../lib/libraryDetails";

/** Only what the header row actually renders. LibraryDetails passes a union of
 *  `LibraryDetailsColumnDef` and a synthetic "name" column that has no
 *  `defaultVisible`, so this is deliberately structural rather than importing
 *  the fuller def — the header has no business knowing about visibility. */
interface HeaderColumn {
  key: LibraryDetailsSortKey;
  label: string;
  className?: string;
}

interface Props {
  columns: readonly HeaderColumn[];
  sortKey: LibraryDetailsSortKey;
  direction: "asc" | "desc";
  rovingHeader: string;
  searching: boolean;
  onFocusColumn: (key: HeaderColumn["key"]) => void;
  onHeaderKeyDown: (e: React.KeyboardEvent) => void;
  onSort: (key: LibraryDetailsSortKey) => void;
}

export default function DetailsHeaderRow({
  columns,
  sortKey,
  direction,
  rovingHeader,
  searching,
  onFocusColumn,
  onHeaderKeyDown,
  onSort,
}: Props) {
  return (
    <thead>
      <tr>
        {columns.map((column) => (
          <th key={column.key} data-col={column.key} className={column.className} scope="col" aria-sort={sortKey === column.key ? (direction === "asc" ? "ascending" : "descending") : "none"}>
            <button
              type="button"
              tabIndex={column.key === rovingHeader ? 0 : -1}
              onFocus={() => onFocusColumn(column.key)}
              onKeyDown={onHeaderKeyDown}
              onClick={() => onSort(column.key)}
            >
              {column.label}{sortKey === column.key ? (direction === "asc" ? " ↑" : " ↓") : ""}
            </button>
          </th>
        ))}
        {/* D2: the reveal-action column — a header cell with no sort
         *  button, so the header roving arithmetic (COLUMNS-indexed)
         *  never sees it. The class is load-bearing (review round 2):
         *  table-layout:fixed takes COLUMN widths from the first row,
         *  so the actions width must live on this th, not the tds. */}
        {searching && <th scope="col" className="qzk-details-actions" aria-label="Show in Library" />}
      </tr>
    </thead>
  );
}
