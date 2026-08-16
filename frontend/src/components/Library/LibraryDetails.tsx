import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { openLibraryNode, selectLibraryNode } from "./libraryOpen";
import {
  detailsNavIndex,
  libraryDetailsRows,
  sortLibraryDetailsRows,
  type LibraryDetailsSortDirection,
  type LibraryDetailsSortKey,
} from "../../lib/libraryDetails";
import type { LibraryHierarchy, LibraryNode } from "../../lib/libraryHierarchy";
import { libraryNodeMatches } from "../../lib/librarySearch";
import { parseQuery } from "../../lib/smartfolders";
import { requestDatasetRemoval } from "../../lib/datasetRemoval";
import { buildArtifactMenu, deleteArtifactConfirmed, isArtifactNode, type ArtifactNode } from "./artifactContextActions";
import { isContextMenuKeyEvent } from "../../lib/contextActions";
import { useApp } from "../../store/useApp";
import ContextMenu from "../overlays/ContextMenu";

interface Props {
  hierarchy: LibraryHierarchy;
  /** PR D2 (L0.26): a non-blank query switches this table into the
   *  project-wide search-results surface — the SAME flat Details projection,
   *  filtered through lib/librarySearch, rendered without hierarchy indent
   *  (the breadcrumb columns carry location), plus a per-row
   *  "Show in Library" reveal. Absent/blank = the ordinary Details renderer. */
  searchQuery?: string;
  /** Clears the search and reveals the row's node in its hierarchy (L0.26's
   *  "Show in Library"). Wired by Library.tsx to the store's reveal signal. */
  onShowInLibrary?: (node: LibraryNode) => void;
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

function isSelected(node: LibraryNode, selectedIds: readonly string[], selection: { kind: string; id: string } | null) {
  return node.kind === "worksheet"
    ? selectedIds.includes(node.entityId)
    : selection?.kind === node.kind && selection.id === node.entityId;
}

export default function LibraryDetails({ hierarchy, searchQuery, onShowInLibrary }: Props) {
  const selectedIds = useApp((s) => s.selectedIds);
  const selection = useApp((s) => s.librarySelection);
  const [sortKey, setSortKey] = useState<LibraryDetailsSortKey>("manual");
  const [direction, setDirection] = useState<LibraryDetailsSortDirection>("asc");
  const [artifactMenu, setArtifactMenu] = useState<{ x: number; y: number; node: ArtifactNode } | null>(null);
  const searching = searchQuery != null && searchQuery.trim() !== "";
  const rows = useMemo(() => {
    let projected = libraryDetailsRows(hierarchy);
    if (searching) {
      const terms = parseQuery(searchQuery);
      projected = projected.filter((row) => libraryNodeMatches(row.node, terms));
    }
    return sortLibraryDetailsRows(projected, sortKey, direction);
  }, [hierarchy, searching, searchQuery, sortKey, direction]);

  // Roving tabindex (plan follow-up 4a): exactly ONE row is in the Tab order
  // at a time — the last-focused row, else the current-item row, else the
  // first. Up/Down/Home/End move real DOM focus through the CURRENT (sorted)
  // row order via detailsNavIndex; a re-sort moves the focused <tr> element,
  // and the browser keeps focus on a moved element, so `focusKey` survives a
  // sort untouched.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  // Sol's PR #141 follow-on: the EIGHT sort headers were eight more Tab
  // stops. Same roving pattern as the rows — one header in the Tab order
  // (the last-focused, else the current sort column, else the first);
  // Left/Right move focus between headers, clamping at the ends. The
  // component's full sequential tab surface is now exactly two stops:
  // the header row and the data row.
  const [headerKey, setHeaderKey] = useState<string | null>(null);
  const rovingHeader = (headerKey != null && COLUMNS.some((c) => c.key === headerKey) ? headerKey : null)
    ?? (sortKey !== "manual" && COLUMNS.some((c) => c.key === sortKey) ? sortKey : COLUMNS[0].key);
  const onHeaderKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const idx = COLUMNS.findIndex((c) => c.key === (event.target as Element).closest("th")?.getAttribute("data-col"));
    if (idx < 0) return;
    event.preventDefault();
    const next = Math.min(COLUMNS.length - 1, Math.max(0, idx + (event.key === "ArrowRight" ? 1 : -1)));
    (scrollRef.current?.querySelector(`th[data-col="${COLUMNS[next].key}"] button`) as HTMLElement | null)?.focus();
  };
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
        <span>{rows.length.toLocaleString()} {searching ? "matches" : "items"}</span>
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
                <th key={column.key} data-col={column.key} className={column.className} scope="col" aria-sort={sortKey === column.key ? (direction === "asc" ? "ascending" : "descending") : "none"}>
                  <button
                    type="button"
                    tabIndex={column.key === rovingHeader ? 0 : -1}
                    onFocus={() => setHeaderKey(column.key)}
                    onKeyDown={onHeaderKeyDown}
                    onClick={() => sortBy(column.key)}
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
                  onClick={() => selectLibraryNode(row.node)}
                  onDoubleClick={() => openLibraryNode(row.node)}
                  onContextMenu={(event) => {
                    selectLibraryNode(row.node);
                    if (!isArtifactNode(row.node)) return;
                    event.preventDefault();
                    setArtifactMenu({ x: event.clientX, y: event.clientY, node: row.node });
                  }}
                  onKeyDown={(event) => {
                    // Match LibraryTree's focused-row contract: a Details row
                    // owns Delete/Backspace before the window-level fallback
                    // can target stale selectedIds (or the active plot). Only
                    // worksheets and artifacts (E-b2) route to their
                    // canonical delete flows; the remaining kinds
                    // (folder/workbook) consume the key here.
                    if (isContextMenuKeyEvent(event) && isArtifactNode(row.node)) {
                      event.preventDefault();
                      const rect = event.currentTarget.getBoundingClientRect();
                      setArtifactMenu({ x: rect.left + 8, y: rect.bottom, node: row.node });
                      return;
                    }
                    if (event.key === "Delete" || event.key === "Backspace") {
                      event.preventDefault();
                      if (row.node.kind === "worksheet") {
                        const ids = useApp.getState().selectedIds;
                        requestDatasetRemoval(
                          ids.length > 0 && ids.includes(row.node.entityId) ? ids : [row.node.entityId],
                        );
                      } else if (isArtifactNode(row.node)) {
                        // E-b2: the canonical registry delete (shared confirm
                        // + dependency warning; fail-closed on source-managed
                        // recovered Origin figures).
                        deleteArtifactConfirmed(row.node);
                      }
                      return;
                    }
                    if (event.key === "Enter") {
                      // D2: Enter on the focused reveal BUTTON is the
                      // button's own activation — let the native click fire
                      // instead of opening the row it sits in.
                      if ((event.target as Element).closest(".qzk-details-reveal")) return;
                      event.preventDefault();
                      openLibraryNode(row.node);
                    }
                  }}
                >
                  <td
                    className="qzk-details-name"
                    style={{ paddingLeft: !searching && sortKey === "manual" ? 8 + row.node.depth * 10 : 8 } as CSSProperties}
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
                  {searching && (
                    <td className="qzk-details-actions">
                      {/* Rides the roving row's tab stop: reachable by Tab
                       *  only from the focused row (one extra stop while
                       *  searching, matching the two-stop philosophy). */}
                      <button
                        type="button"
                        className="qzk-details-reveal"
                        aria-label="Show in Library"
                        title="Show in Library"
                        tabIndex={row.node.key === rovingKey ? 0 : -1}
                        onClick={(event) => {
                          event.stopPropagation(); // never also select/open the row
                          onShowInLibrary?.(row.node);
                        }}
                        onDoubleClick={(event) => event.stopPropagation()}
                      >
                        {/* Compact glyph at narrow container widths, full text
                         *  at ≥300px — the accessible name lives on the button
                         *  either way (review round 2: the text button clipped
                         *  outside its cell at the default 210px panel). */}
                        <span className="qzk-reveal-glyph" aria-hidden="true">⌖</span>
                        <span className="qzk-reveal-text">Show in Library</span>
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {searching && rows.length === 0 && (
          <div className="qzk-ds-meta" style={{ padding: 8, textAlign: "center" }}>
            No matches
          </div>
        )}
      </div>
      {artifactMenu && (
        <ContextMenu
          x={artifactMenu.x}
          y={artifactMenu.y}
          items={buildArtifactMenu(artifactMenu.node)}
          onClose={() => setArtifactMenu(null)}
        />
      )}
    </div>
  );
}
