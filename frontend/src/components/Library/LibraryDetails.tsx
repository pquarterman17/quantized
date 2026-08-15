import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { openLibraryNode } from "./libraryOpen";
import {
  detailsNavIndex,
  libraryDetailsRows,
  sortLibraryDetailsRows,
  type LibraryDetailsSortDirection,
  type LibraryDetailsSortKey,
} from "../../lib/libraryDetails";
import type { LibraryHierarchy, LibraryNode } from "../../lib/libraryHierarchy";
import { requestDatasetRemoval } from "../../lib/datasetRemoval";
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

  // Roving tabindex (plan follow-up 4a): exactly ONE row is in the Tab order
  // at a time — the last-focused row, else the current-item row, else the
  // first. Up/Down/Home/End move real DOM focus through the CURRENT (sorted)
  // row order via detailsNavIndex; a re-sort moves the focused <tr> element,
  // and the browser keeps focus on a moved element, so `focusKey` survives a
  // sort untouched.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const prevRowsRef = useRef(rows);
  const keyIndex = (key: string | null): number => (key == null ? -1 : rows.findIndex((r) => r.node.key === key));
  const selectedRow = rows.find((r) => isSelected(r.node, selectedIds, selection));
  const rovingKey = (focusKey != null && keyIndex(focusKey) >= 0 ? focusKey : null) ?? selectedRow?.node.key ?? rows[0]?.node.key ?? null;

  const focusRowAt = (index: number): void => {
    const key = rows[index]?.node.key;
    if (key == null) return;
    (scrollRef.current?.querySelector(`[data-lib-row="${CSS.escape(key)}"]`) as HTMLElement | null)?.focus();
  };

  // Focus survives removal of the focused row (same contract as
  // LibraryTree.tsx): when the row that held focus is gone after a re-render
  // and the DOM orphaned focus to <body>, land on the nearest surviving row
  // by its PREVIOUS position — never steal focus that moved elsewhere.
  useEffect(() => {
    if (focusKey != null && keyIndex(focusKey) < 0 && document.activeElement === document.body) {
      const prevIdx = prevRowsRef.current.findIndex((r) => r.node.key === focusKey);
      focusRowAt(Math.min(Math.max(prevIdx, 0), rows.length - 1));
    }
    prevRowsRef.current = rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed off the row list only
  }, [rows]);

  const onNavKeyDown = (event: React.KeyboardEvent): void => {
    const target = (event.target as Element).closest("[data-lib-row]");
    if (!target) {
      // P1 review fix, belt half: a keystroke inside the table area that
      // didn't land on a row — the focusable sort-header buttons are the
      // real-browser case — must not reach the global handlers: nav keys
      // would step the dataset navigator, Delete/Backspace would remove the
      // selected/active dataset (retrospective-audit P1). Consumed here;
      // Enter/Space pass untouched so header buttons still activate.
      const destructive = event.key === "Delete" || event.key === "Backspace";
      if (destructive || detailsNavIndex(rows.length, -1, event.key) != null) event.preventDefault();
      return;
    }
    // 4a booking: NO Left/Right — disclosure is a hierarchy gesture and this
    // is a flat (possibly sorted) table; those keys bubble on untouched.
    const next = detailsNavIndex(rows.length, keyIndex(target.getAttribute("data-lib-row")), event.key);
    if (next == null) return;
    // preventDefault also gates the window-level single-key handlers (the
    // global prev/next-dataset arrows honor defaultPrevented) and page scroll.
    event.preventDefault();
    focusRowAt(next);
  };

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
      {/* P1 review fix: the scroll wrapper is NOT in the Tab order — the
       *  roving row is this component's single sequential tab stop, so
       *  keyboard entry lands directly on the current row and a focused
       *  wrapper can never leak Up/Down past onNavKeyDown's row check to
       *  the global dataset navigator. The accessible name lives on the
       *  <table> itself, where it labels a real role. */}
      <div className="qzk-details-scroll" ref={scrollRef} onKeyDown={onNavKeyDown}>
        <table className="qzk-details-table" aria-label="Library details table">
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
                  tabIndex={row.node.key === rovingKey ? 0 : -1}
                  aria-selected={selected}
                  title={title}
                  onFocus={() => setFocusKey(row.node.key)}
                  onClick={() => selectNode(row.node)}
                  onDoubleClick={() => openLibraryNode(row.node)}
                  onContextMenu={() => selectNode(row.node)}
                  onKeyDown={(event) => {
                    // Match LibraryTree's focused-row contract: a Details row
                    // owns Delete/Backspace before the window-level fallback
                    // can target stale selectedIds (or the active plot). Only
                    // worksheets have an enabled delete flow in this slice;
                    // every other kind consumes the key until its canonical
                    // registry action is available through L1.4.
                    if (event.key === "Delete" || event.key === "Backspace") {
                      event.preventDefault();
                      if (row.node.kind === "worksheet") {
                        const ids = useApp.getState().selectedIds;
                        requestDatasetRemoval(
                          ids.length > 0 && ids.includes(row.node.entityId) ? ids : [row.node.entityId],
                        );
                      }
                      return;
                    }
                    if (event.key === "Enter") {
                      event.preventDefault();
                      openLibraryNode(row.node);
                    }
                  }}
                >
                  <td
                    className="qzk-details-name"
                    style={{ paddingLeft: sortKey === "manual" ? 8 + row.node.depth * 10 : 8 } as CSSProperties}
                  >
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
