import { useEffect, useMemo, useRef, useState, type RefObject } from "react";

import DetailsHeaderRow from "./DetailsHeaderRow";
import DetailsRow, { isTextEditorTarget, type DetailsRenameState } from "./DetailsRow";
import { useDetailsDragDropContext } from "./useDetailsDragDrop";
import { isSelected } from "./libraryOpen";
import { useLibraryDetailsVirtualization } from "./useLibraryDetailsVirtualization";
import {
  detailsNavIndex,
  libraryDetailsRows,
  sortLibraryDetailsRows,
  type LibraryDetailsSortDirection,
  type LibraryDetailsSortKey,
} from "../../lib/libraryDetails";
import { LIBRARY_DETAILS_COLUMNS } from "../../lib/libraryDetailsColumns";
import type { LibraryHierarchy, LibraryNode } from "../../lib/libraryHierarchy";
import { libraryNodeMatches } from "../../lib/librarySearch";
import { parseQuery } from "../../lib/smartfolders";
import type { BatchMetadataPatch } from "../../store/datasetMeta";
import { toast } from "../../store/toasts";
import { useApp } from "../../store/useApp";
import { useLibraryStore } from "../../store/hooks/useLibraryStore";
import { askParams } from "../overlays/ParamDialog";
import LibraryDetailsColumnsMenu from "./LibraryDetailsColumnsMenu";

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
  /** The real scrolling ancestor — see LibraryTree's identical prop doc.
   *  Absent in standalone test harnesses. */
  panelRef?: RefObject<HTMLElement | null>;
}

// PR L (L0.56) — Name is the one mandatory, non-toggleable column; every
// other header comes from the user's `visibleColumns` selection below.
const NAME_COLUMN: { key: "name"; label: string; className?: string } = { key: "name", label: "Name" };

/** Batch-edit dialog -> BatchMetadataPatch. A checked "Clear x" wins over a
 *  typed value (clearing while also typing text is a contradiction; the
 *  explicit clear is the less surprising outcome to honor). */
function batchPatchFrom(picked: Record<string, unknown>): BatchMetadataPatch {
  const patch: BatchMetadataPatch = {};
  if (picked.clearNotes) patch.notes = "";
  else if (String(picked.notes ?? "").trim()) patch.notes = String(picked.notes);
  if (picked.clearGroup) patch.group = "";
  else if (String(picked.group ?? "").trim()) patch.group = String(picked.group);
  const addTags = String(picked.addTags ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  const removeTags = String(picked.removeTags ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  if (addTags.length) patch.addTags = addTags;
  if (removeTags.length) patch.removeTags = removeTags;
  return patch;
}

export default function LibraryDetails({ hierarchy, searchQuery, onShowInLibrary, panelRef }: Props) {
  const selectedIds = useApp((s) => s.selectedIds);
  // E-c3 "keep selection operations indexed": built once per render, not
  // once per row — see isSelected's doc in libraryOpen.ts.
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selection = useLibraryStore((s) => s.librarySelection);
  const [sortKey, setSortKey] = useState<LibraryDetailsSortKey>("manual");
  const [direction, setDirection] = useState<LibraryDetailsSortDirection>("asc");
  // PR L slice 2 (L0.56): the user's selected metadata columns — now the
  // store field (store/libraryDetailsColumns.ts), .dwk-persisted (additive;
  // absent on an older doc loads as today's original seven, unchanged).
  const visibleColumnsArr = useApp((s) => s.visibleDetailsColumns);
  const toggleColumn = useApp((s) => s.toggleVisibleDetailsColumn);
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  const visibleColumns = useMemo(() => new Set(visibleColumnsArr), [visibleColumnsArr]);
  const columns = useMemo(
    () => [NAME_COLUMN, ...LIBRARY_DETAILS_COLUMNS.filter((c) => visibleColumns.has(c.key))],
    [visibleColumns],
  );
  const searching = searchQuery != null && searchQuery.trim() !== "";
  const rows = useMemo(() => {
    let projected = libraryDetailsRows(hierarchy);
    if (searching) {
      const terms = parseQuery(searchQuery);
      projected = projected.filter((row) => libraryNodeMatches(row.node, terms));
    }
    return sortLibraryDetailsRows(projected, sortKey, direction);
  }, [hierarchy, searching, searchQuery, sortKey, direction]);
  const colSpan = columns.length + (searching ? 1 : 0);

  // Roving tabindex (plan follow-up 4a): exactly ONE row is in the Tab order
  // at a time — the last-focused row, else the current-item row, else the
  // first. Up/Down/Home/End move real DOM focus through the CURRENT (sorted)
  // row order via detailsNavIndex; a re-sort moves the focused <tr> element,
  // and the browser keeps focus on a moved element, so `focusKey` survives a
  // sort untouched.
  const [focusKey, setFocusKey] = useState<string | null>(null);
  // L1.4 review round: the ONE open inline rename editor — which row owns it
  // and the live draft — belongs here, beside `focusKey`, not inside the row.
  // Under virtualization a row unmounts the moment it scrolls out of the
  // window, and React fires no blur on unmount, so row-local state would
  // silently destroy a half-typed name with nothing committed. Held here the
  // draft survives the scroll and the editor comes back when the row does.
  const [rename, setRename] = useState<DetailsRenameState | null>(null);
  // ONE set of drag/drop store subscriptions for the whole table (the per-row
  // hook used to hold five each — 200 for a 40-row window).
  const dndContext = useDetailsDragDropContext();
  // Sol's PR #141 follow-on: the EIGHT sort headers were eight more Tab
  // stops. Same roving pattern as the rows — one header in the Tab order
  // (the last-focused, else the current sort column, else the first);
  // Left/Right move focus between headers, clamping at the ends. The
  // component's full sequential tab surface is now exactly two stops:
  // the header row and the data row.
  const [headerKey, setHeaderKey] = useState<string | null>(null);
  const rovingHeader = (headerKey != null && columns.some((c) => c.key === headerKey) ? headerKey : null)
    ?? (sortKey !== "manual" && columns.some((c) => c.key === sortKey) ? sortKey : columns[0].key);
  const onHeaderKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const idx = columns.findIndex((c) => c.key === (event.target as Element).closest("th")?.getAttribute("data-col"));
    if (idx < 0) return;
    event.preventDefault();
    const next = Math.min(columns.length - 1, Math.max(0, idx + (event.key === "ArrowRight" ? 1 : -1)));
    (scrollRef.current?.querySelector(`th[data-col="${columns[next].key}"] button`) as HTMLElement | null)?.focus();
  };
  const prevRowsRef = useRef(rows);
  const keyIndex = (key: string | null): number => (key == null ? -1 : rows.findIndex((r) => r.node.key === key));
  const selectedRow = rows.find((r) => isSelected(r.node, selectedIdSet, selection));
  const rovingKey = (focusKey != null && keyIndex(focusKey) >= 0 ? focusKey : null) ?? selectedRow?.node.key ?? rows[0]?.node.key ?? null;
  // E-c3 large-Library safeguard: windowed rendering above VIRTUALIZE_ABOVE,
  // the fallback tab stop when the model one scrolls out, and the
  // virtualization-aware focusRowAt/"keep selection visible" effect all live
  // in this sibling hook — see its header.
  const { scrollRef, virt, rendered, effectiveRovingKey, focusRowAt } =
    useLibraryDetailsVirtualization(rows, panelRef, rovingKey, selectedRow);

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
    // L1.4: a row's inline rename input owns its own keys. `.closest(
    // "[data-lib-row]")` below resolves ANY descendant — including that
    // input — to its ancestor row, which is exactly how LibraryTree's P2
    // "keyboard hijack" bug let Up/Down escape a text editor as roving
    // navigation. Must run FIRST, and must not preventDefault: the cursor
    // keys are the editor's.
    if (isTextEditorTarget(event.target as Element)) return;
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
    const fromKey = target.getAttribute("data-lib-row");
    const next = detailsNavIndex(rows.length, keyIndex(fromKey), event.key);
    if (next == null) return;
    // preventDefault also gates the window-level single-key handlers (the
    // global prev/next-dataset arrows honor defaultPrevented) and page scroll.
    event.preventDefault();
    focusRowAt(next, fromKey ?? undefined);
  };

  const sortBy = (key: LibraryDetailsSortKey) => {
    if (sortKey === key) setDirection((value) => (value === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setDirection("asc");
    }
  };

  // PR L (L0.56): shows the affected-item count IN the dialog title before
  // apply. ONE store call for the whole selection (store/datasetMeta.ts's
  // `batchEditDatasetMetadata` records ONE history entry), so Ctrl+Z undoes
  // the entire batch in one step. `ids` is captured before the async dialog,
  // so every named dataset can be deleted/trashed while it's open
  // (adversarial-review P2) — the confirmation toast reports the store's
  // returned LIVE-applied count, never the stale `ids.length`, and stays
  // silent entirely when that count is 0 (a no-op edit deserves no "it
  // happened" confirmation).
  const onBatchEditMetadata = async (): Promise<void> => {
    const ids = useApp.getState().selectedIds;
    if (ids.length < 2) return;
    const picked = await askParams(`Edit metadata for ${ids.length} selected`, [
      { key: "notes", label: "Notes", type: "text", default: "", hint: "blank = leave unchanged" },
      { key: "clearNotes", label: "Clear notes", type: "boolean", default: false },
      { key: "group", label: "Group", type: "text", default: "", hint: "blank = leave unchanged" },
      { key: "clearGroup", label: "Clear group", type: "boolean", default: false },
      { key: "addTags", label: "Add tags", type: "text", default: "", hint: "comma-separated" },
      { key: "removeTags", label: "Remove tags", type: "text", default: "", hint: "comma-separated" },
    ]);
    if (!picked) return;
    const updated = useApp.getState().batchEditDatasetMetadata(ids, batchPatchFrom(picked));
    if (updated > 0) toast(`Updated metadata for ${updated} dataset(s)`);
  };

  return (
    <div className="qzk-details-wrap">
      <div className="qzk-details-tools">
        <span>{rows.length.toLocaleString()} {searching ? "matches" : "items"}</span>
        <div className="qzk-details-tools-actions">
          {/* PR L (L0.56): multi-select rows -> edit a metadata field/tags
           *  once -> applies to all selected. selectedIds IS the worksheet
           *  selection (L0.25), so no extra filtering is needed here. */}
          {selectedIds.length >= 2 && (
            <button type="button" className="qzk-details-manual" onClick={() => void onBatchEditMetadata()}>
              Edit metadata ({selectedIds.length})…
            </button>
          )}
          {sortKey !== "manual" && (
            <button type="button" className="qzk-details-manual" onClick={() => { setSortKey("manual"); setDirection("asc"); }}>
              Manual order
            </button>
          )}
          <LibraryDetailsColumnsMenu
            open={columnsMenuOpen}
            visibleColumns={visibleColumns}
            onToggleOpen={() => setColumnsMenuOpen((v) => !v)}
            onToggleColumn={toggleColumn}
          />
        </div>
      </div>
      {/* P1 review fix: the scroll wrapper is NOT in the Tab order — the
       *  roving row is this component's single sequential tab stop, so
       *  keyboard entry lands directly on the current row and a focused
       *  wrapper can never leak Up/Down past onNavKeyDown's row check to
       *  the global dataset navigator. The accessible name lives on the
       *  <table> itself, where it labels a real role. */}
      <div className="qzk-details-scroll" ref={scrollRef} onKeyDown={onNavKeyDown}>
        {/* REVIEW ROUND: a VIRTUALIZED table must declare its true size. Without
            `aria-rowcount` a screen reader announces only the rendered window
            (~40 rows) as the entire table, so a 5,000-row Library sounds like a
            40-row one — an accessibility regression introduced BY the
            windowing. Each row carries its absolute `aria-rowindex` (1-based,
            header row = 1) so "row 3,214 of 5,000" stays truthful while
            scrolling. Unvirtualized, the DOM already tells the whole truth, so
            the attributes are omitted rather than asserted redundantly. */}
        <table
          className="qzk-details-table"
          aria-label="Library details table"
          {...(virt.virtualized ? { "aria-rowcount": rows.length } : {})}
        >
          <DetailsHeaderRow
            columns={columns}
            sortKey={sortKey}
            direction={direction}
            rovingHeader={rovingHeader}
            searching={searching}
            onFocusColumn={setHeaderKey}
            onHeaderKeyDown={onHeaderKeyDown}
            onSort={sortBy}
          />
          <tbody>
            {/* E-c3: leading spacer — see useListVirtualization's header.
             *  aria-hidden keeps it out of getAllByRole("row") the same way
             *  it's kept out of a screen reader's row count. */}
            {virt.padTop > 0 && (
              <tr aria-hidden="true" style={{ height: virt.padTop }}><td colSpan={colSpan} /></tr>
            )}
            {rendered.map((row, i) => (
              <DetailsRow
                key={row.node.key}
                row={row}
                columns={columns}
                // Absolute position in the FULL model, not the window: 1-based
                // with the header row occupying index 1 (see the table's note).
                ariaRowIndex={virt.virtualized ? (virt.start + i) + 2 : null}
                selectedIdSet={selectedIdSet}
                selectedIds={selectedIds}
                selection={selection}
                rovingKey={effectiveRovingKey}
                indent={!searching && sortKey === "manual" ? 8 + row.node.depth * 10 : 8}
                searching={searching}
                renameDraft={rename?.key === row.node.key ? rename.draft : null}
                onRenameChange={setRename}
                dndContext={dndContext}
                onFocusRow={setFocusKey}
                onShowInLibrary={onShowInLibrary}
              />
            ))}
            {virt.padBottom > 0 && (
              <tr aria-hidden="true" style={{ height: virt.padBottom }}><td colSpan={colSpan} /></tr>
            )}
          </tbody>
        </table>
        {searching && rows.length === 0 && (
          <div className="qzk-ds-meta" style={{ padding: 8, textAlign: "center" }}>
            No matches
          </div>
        )}
      </div>
    </div>
  );
}
