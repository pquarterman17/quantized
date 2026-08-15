import { useMemo, useState, type CSSProperties } from "react";

import { openLibraryNode } from "./libraryOpen";
import {
  libraryDetailsRows,
  sortLibraryDetailsRows,
  type LibraryDetailsSortDirection,
  type LibraryDetailsSortKey,
} from "../../lib/libraryDetails";
import type { LibraryHierarchy, LibraryNode } from "../../lib/libraryHierarchy";
import { useApp } from "../../store/useApp";

interface Props {
  hierarchy: LibraryHierarchy;
}

const COLUMNS: Array<{ key: Exclude<LibraryDetailsSortKey, "manual">; label: string; className?: string }> = [
  { key: "name", label: "Name" },
  { key: "type", label: "Type" },
  { key: "location", label: "Folder / workbook", className: "qzk-details-wide" },
  { key: "dimensions", label: "Rows × cols", className: "qzk-details-medium" },
  { key: "dataType", label: "Data type", className: "qzk-details-wide" },
  { key: "source", label: "Source", className: "qzk-details-medium" },
  { key: "modified", label: "Imported / modified", className: "qzk-details-wide" },
  { key: "tags", label: "Tags", className: "qzk-details-wide" },
];

function selectNode(node: LibraryNode): void {
  const s = useApp.getState();
  if (node.kind === "worksheet") s.selectIds([node.entityId]);
  else s.setLibrarySelection({ kind: node.kind, id: node.entityId });
}

function isSelected(node: LibraryNode, selectedIds: readonly string[], selection: { kind: string; id: string } | null) {
  return node.kind === "worksheet"
    ? selectedIds.includes(node.entityId)
    : selection?.kind === node.kind && selection.id === node.entityId;
}

export default function LibraryDetails({ hierarchy }: Props) {
  const selectedIds = useApp((s) => s.selectedIds);
  const selection = useApp((s) => s.librarySelection);
  const [sortKey, setSortKey] = useState<LibraryDetailsSortKey>("manual");
  const [direction, setDirection] = useState<LibraryDetailsSortDirection>("asc");
  const rows = useMemo(
    () => sortLibraryDetailsRows(libraryDetailsRows(hierarchy), sortKey, direction),
    [hierarchy, sortKey, direction],
  );

  const sortBy = (key: LibraryDetailsSortKey) => {
    if (sortKey === key) setDirection((value) => (value === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setDirection("asc");
    }
  };

  return (
    <div className="qzk-details-wrap">
      <div className="qzk-details-tools">
        <span>{rows.length.toLocaleString()} items</span>
        {sortKey !== "manual" && (
          <button type="button" className="qzk-details-manual" onClick={() => { setSortKey("manual"); setDirection("asc"); }}>
            Manual order
          </button>
        )}
      </div>
      <div className="qzk-details-scroll" tabIndex={0} aria-label="Library details table">
        <table className="qzk-details-table">
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <th key={column.key} className={column.className} scope="col" aria-sort={sortKey === column.key ? (direction === "asc" ? "ascending" : "descending") : "none"}>
                  <button type="button" onClick={() => sortBy(column.key)}>
                    {column.label}{sortKey === column.key ? (direction === "asc" ? " ↑" : " ↓") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const selected = isSelected(row.node, selectedIds, selection);
              const title = `${row.node.name} — ${row.type}; ${row.location}; ${row.dimensions}; ${row.source}`;
              return (
                <tr
                  key={row.node.key}
                  className={selected ? "selected" : undefined}
                  data-lib-row={row.node.key}
                  data-ds-id={row.node.kind === "worksheet" ? row.node.entityId : undefined}
                  tabIndex={0}
                  aria-selected={selected}
                  title={title}
                  onClick={() => selectNode(row.node)}
                  onDoubleClick={() => openLibraryNode(row.node)}
                  onContextMenu={() => selectNode(row.node)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      openLibraryNode(row.node);
                    }
                  }}
                >
                  <td className="qzk-details-name" style={{ paddingLeft: 8 + row.node.depth * 10 } as CSSProperties}>
                    <span aria-hidden="true">{row.node.kind === "folder" ? "▦" : row.node.kind === "workbook" ? "▤" : "·"}</span>
                    <span>{row.node.name}</span>
                    <small>{row.location} · {row.dimensions}</small>
                  </td>
                  <td>{row.type}</td>
                  <td className="qzk-details-wide">{row.location}</td>
                  <td className="qzk-details-medium">{row.dimensions}</td>
                  <td className="qzk-details-wide">{row.dataType}</td>
                  <td className="qzk-details-medium">{row.source}</td>
                  <td className="qzk-details-wide">{row.modified}</td>
                  <td className="qzk-details-wide">{row.tags}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
