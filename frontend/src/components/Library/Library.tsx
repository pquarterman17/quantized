// Left Project Explorer: imports, folder/workbook/worksheet hierarchy,
// selection, search/reveal, view switching, and session-only browse focus.
// The canonical structure remains lib/libraryHierarchy; this component only
// composes its presentation and the panel-level interaction surfaces.

import { useEffect, useRef, useState } from "react";

import { lazyRegion } from "../../lib/lazyRegion";
import LibrarySections from "./LibrarySections";
import LibraryFocusBar from "./LibraryFocusBar";
import LibraryExplorerControls from "./LibraryExplorerControls";
import { LIBRARY_NODE_GLYPH } from "./nodeIcons";
import LibraryViewSelector from "./LibraryViewSelector";
import { useLibraryHierarchyModel } from "./useLibraryHierarchyRows";
import { useLibraryFocus } from "./useLibraryFocus";
import { useLibraryResize } from "./useLibraryResize";
import { useLibraryViewTransition } from "./useLibraryViewTransition";
import { makeDemoDataset } from "../../lib/demo";
import { folderPath } from "../../lib/foldertree";
import { originSheetGroups, originSheetNumber } from "../../lib/grouping";
import { chooseAndImport } from "../../lib/importEntry";
import { IMPORT_ACCEPT } from "../../lib/openFilePicker";
import { matchesQuery, parseQuery } from "../../lib/smartfolders";
import type { LibraryViewMode } from "../../lib/libraryViewPrefs";
import { libraryNodeCount, type LibraryContentFilter } from "../../lib/libraryExplorer";
import type { LibraryNode, LibraryNodeKey } from "../../lib/libraryHierarchy";
import { selectLibraryNode } from "./libraryOpen";

// Bundle diet slice 4 (plans/BUNDLE_HEADROOM.md): the multi-select action bar
// renders null below two selected rows, so its chunk waits for the second row
// the user picks. The flat sections are deferred the same way, one gate each,
// inside LibrarySections.tsx.
const MultiSelectBar = lazyRegion(() => import("./MultiSelectBar"), "Library");
// PR C: LibraryTree pulls in WorkbookRow/ArtifactRows/the workbook menu
// registry/FolderRow — lazy like the sections (MAIN_PLAN #29's
// eager-bundle budget; the pure hierarchy build itself stays eager via
// useLibraryHierarchyRows since `rows.length` drives inTree/HomeScreen).
const LibraryTree = lazyRegion(() => import("./LibraryTree"), "Library");
const LibraryDetails = lazyRegion(() => import("./LibraryDetails"), "Library");
// The resume/start surface exists only for a genuinely empty Library. Keep it
// out of every established project's startup bundle. Like the other optional
// Library bodies it has no Suspense fallback: an empty Library shows nothing
// below the header for the one localhost chunk fetch, then Home.
const HomeScreen = lazyRegion(() => import("./HomeScreen"), "Library");
// Bundle diet slice 6 (plans/BUNDLE_HEADROOM.md): the flat-list fallback body
// (query empty, hierarchy empty) — see LibraryFlatRows.tsx's own header for
// why this is the only static edge that kept DatasetRow.tsx eager.
const LibraryFlatRows = lazyRegion(() => import("./LibraryFlatRows"), "Library");
import type { Dataset } from "../../lib/types";
import { nextDatasetId, useApp } from "../../store/useApp";
import { useLibraryStore } from "../../store/hooks/useLibraryStore";
import { askParams } from "../overlays/ParamDialog";

let demoSeq = 0;
const ACCEPT = IMPORT_ACCEPT;

interface LibraryProps {
  /** App owns this while the wide Tiles workspace is available. Tests and
   *  embedded harnesses may omit it and retain the original local behavior. */
  viewMode?: LibraryViewMode;
  onViewModeChange?: (mode: LibraryViewMode) => void;
}

export default function Library({ viewMode: controlledViewMode, onViewModeChange }: LibraryProps = {}) {
  const datasets = useApp((s) => s.datasets);
  const activeId = useApp((s) => s.activeId);
  const selectedIds = useApp((s) => s.selectedIds);
  const addDataset = useApp((s) => s.addDataset);
  const importFiles = useApp((s) => s.importFiles);
  const folders = useApp((s) => s.folders);
  const createFolder = useApp((s) => s.createFolder);
  const addSmartFolder = useApp((s) => s.addSmartFolder);
  const addCollection = useApp((s) => s.addCollection);
  const expandedFolders = useApp((s) => s.expandedFolders);
  const toggleFolderExpanded = useApp((s) => s.toggleFolderExpanded);
  const expandedWorkbookIds = useLibraryStore((s) => s.expandedWorkbookIds);
  const toggleWorkbookExpanded = useLibraryStore((s) => s.toggleWorkbookExpanded);
  const revealTarget = useLibraryStore((s) => s.revealTarget);
  const clearReveal = useLibraryStore((s) => s.clearReveal);
  const startResize = useLibraryResize();
  // E-c3 large-Library safeguard: the ONE real scrolling ancestor for both
  // Tree and Details — header/search/sections and the row list share this
  // one scrollbar (shell.css's `.qzk-library { overflow-y: auto }`), so
  // their virtualization hooks must measure/scroll THIS element, not their
  // own row container.
  const panelRef = useRef<HTMLElement>(null);
  const { hierarchy, rows: allRows } = useLibraryHierarchyModel();
  const [query, setQuery] = useState("");
  const [contentFilter, setContentFilter] = useState<LibraryContentFilter>("all");
  const [dragging, setDragging] = useState(false);
  const { viewMode, changeViewMode, rememberLibraryFocus } = useLibraryViewTransition({
    controlledMode: controlledViewMode, onModeChange: onViewModeChange,
    hierarchy, rows: allRows, expandedFolders, expandedWorkbookIds,
    toggleFolderExpanded, toggleWorkbookExpanded,
  });
  const libraryFocus = useLibraryFocus(hierarchy, allRows, contentFilter);

  // "Show in Library" (plan #13 sub-item 2; PR C adds the workbook step;
  // PR D2 generalizes it to EVERY hierarchy node kind for L0.26's search
  // reveal): the target posted to `revealTarget` — a canonical
  // `kind:id` LibraryNodeKey, or a bare dataset id (the pre-D2 callers) —
  // clears the filter, expands every collapsed ancestor folder/workbook,
  // selects the node per the L0.25 contract, and scrolls its row into view,
  // then clears the signal. A stale/unknown target just clears silently.
  useEffect(() => {
    if (!revealTarget) return;
    const key = (revealTarget.includes(":") ? revealTarget : `worksheet:${revealTarget}`) as LibraryNodeKey;
    clearReveal();
    const node = hierarchy.byKey.get(key);
    if (!node) return;
    libraryFocus.clearFocus();
    setQuery("");
    const s = useApp.getState();
    let parentKey = node.parentKey;
    while (parentKey) {
      const parent = hierarchy.byKey.get(parentKey);
      if (!parent) break;
      if (parent.kind === "folder" && !s.expandedFolders.includes(parent.entityId)) toggleFolderExpanded(parent.entityId);
      if (parent.kind === "workbook" && !s.expandedWorkbookIds.includes(parent.entityId)) toggleWorkbookExpanded(parent.entityId);
      parentKey = parent.parentKey;
    }
    // Compatibility half (the pre-D2 contract): a legacy worksheet with a
    // folderId but no workbook sits at the hierarchy ROOT (nesting is
    // workbook-driven), so its folder ancestors don't appear in the parent
    // walk above — expand them from the folder tree exactly as before.
    if (node.kind === "worksheet") {
      for (const f of folderPath(folders, node.entity.folderId ?? null)) {
        if (!useApp.getState().expandedFolders.includes(f.id)) toggleFolderExpanded(f.id);
      }
    }
    selectLibraryNode(node);
    // The row may be inside a lazy renderer that only mounts after the
    // query clears — retry across a few frames like the focus-restore
    // effect above rather than introducing timers.
    let attempts = 0;
    const tryScroll = (): void => {
      const target = document.querySelector(
        `[data-lib-row="${CSS.escape(key)}"], [data-ds-id="${CSS.escape(node.entityId)}"]`,
      );
      if (target) target.scrollIntoView?.({ block: "nearest" }); // absent in jsdom
      else if (++attempts < 5) requestAnimationFrame(tryScroll);
    };
    requestAnimationFrame(tryScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires only on revealTarget
  }, [revealTarget]);

  // MAIN #31: routes through the shared entry point so a desktop shell gets a
  // NATIVE dialog (paths -> source.path) and a browser gets today's picker.
  const onImport = () => void chooseAndImport(useApp.getState(), ACCEPT);

  const onDemo = () => {
    const ds: Dataset = {
      id: nextDatasetId(),
      name: `demo-vsm-${++demoSeq}.dat`,
      data: makeDemoDataset(),
    };
    addDataset(ds);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) void importFiles(files);
  };

  // Filter through the shared smart-folder grammar (lib/smartfolders): a bare
  // term matches the dataset name OR any tag (the historical behavior — a tag
  // chip click still just sets the query), while tag:/name:/format: terms
  // narrow to one field. The SAME matcher powers saved smart folders, so a
  // query proven here can be saved as one via the ☆ button (item 9).
  const terms = parseQuery(query);
  const shown = datasets.filter((d) => matchesQuery(d, terms));
  // Reorder is the flat manual-order tool; it operates on the global list, so it
  // only makes sense when the list isn't filtered or organized into folders (the
  // tree has its own drag reorder — item 3b — plus its menu ordering).
  const canReorder = query.trim() === "" && folders.length === 0;

  // Non-first sheets of a multi-sheet Origin pseudo-book get a subtle indent +
  // "sheet N" chip in the row so the parent/child relation reads at a glance —
  // but ONLY as a fallback for un-foldered legacy datasets (a pre-item-4 .dwk):
  // once folders exist, the real nesting from `planOriginFolders` already
  // conveys the same relationship, so the chip would just be a redundant
  // decoration on top of it (item 4/6 — retire as the primary indicator).
  // Computed off the full library (not `shown`) so filtering doesn't change it.
  const sheetOf = new Map<string, number>();
  if (folders.length === 0) {
    for (const g of originSheetGroups(datasets)) {
      for (const member of g.members) {
        const n = originSheetNumber(member);
        if (n > 1) sheetOf.set(member.id, n);
      }
    }
  }

  const searchActive = query.trim() !== "";
  // Search uses the project-wide Details surface; otherwise render the
  // current Tree/Details explorer projection.
  const rows = libraryFocus.rows;
  const browseHierarchy = libraryFocus.hierarchy;
  const inHierarchy = query.trim() === "" && allRows.length > 0;
  const showInLibrary = (node: LibraryNode): void => {
    setQuery("");
    useApp.getState().requestReveal(node.key);
  };
  let body: React.ReactNode;
  if (query.trim() !== "") {
    body = (
      <LibraryDetails hierarchy={libraryFocus.projectHierarchy} searchQuery={query} onShowInLibrary={showInLibrary} panelRef={panelRef} />
    );
  } else if (inHierarchy && rows.length === 0) {
    const emptyLabel = contentFilter === "data" ? "data" : contentFilter;
    body = <div className="qzk-library-filter-empty"><span>No {emptyLabel} in this view.</span><button type="button" onClick={() => setContentFilter("all")}>Show all items</button></div>;
  } else if (inHierarchy && viewMode === "details") {
    body = <LibraryDetails hierarchy={browseHierarchy} panelRef={panelRef} />;
  } else if (inHierarchy) {
    // Tiles owns the main workspace; the narrow Library deliberately remains
    // an Origin-like tree navigator while that workspace is open (L0.15).
    body = <LibraryTree rows={rows} onFilterTag={setQuery} panelRef={panelRef} onFocusContainer={libraryFocus.focusOn} />;
  } else if (shown.length > 0) {
    // This branch is unreachable in today's app (PR C: `rows.length === 0`
    // implies `datasets.length === 0`, which implies `shown.length === 0`
    // too — see LibraryFlatRows.tsx's own header), but the gate is kept
    // explicit and cheap rather than assumed. `shown` is already computed
    // above, for the same reason `HomeScreen`'s own `rows.length === 0`
    // check, one line below, is already free — no new derived state. Without
    // this gate, mounting the branch on `rows.length === 0` alone would
    // fetch LibraryFlatRows' chunk (and DatasetRow/datasetRowMenu/Sparkline
    // with it) on every cold start to render zero rows — a real, avoidable
    // round trip on exactly the surface this seam's cost argument rests on
    // being free.
    body = (
      <LibraryFlatRows
        shown={shown}
        datasets={datasets}
        activeId={activeId}
        selectedIds={selectedIds}
        canReorder={canReorder}
        sheetOf={sheetOf}
        onFilterTag={setQuery}
      />
    );
  } else {
    body = null;
  }

  return (
    <aside
      ref={panelRef}
      className={`qzk-library${dragging ? " dragover" : ""}`}
      onDragOver={(e) => {
        // Only react to OS file drags; an internal dataset drag (row → folder) is
        // handled by FolderRow and must not trip the file-import dropzone.
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        if (!dragging) setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
      onFocusCapture={rememberLibraryFocus}
    >
      <div className="qzk-lib-head">
        <span className="qzk-lib-title">Library</span>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            className="qz-icon-btn"
            title="New folder"
            onClick={() => createFolder(null, "New Folder")}
          >
            {/* UX-004 (the ONLY change this file takes: this command names a
             *  node kind, so it wears that kind's mark from `nodeIcons.ts`
             *  instead of a literal ▦ that no longer means "folder"). */}
            {LIBRARY_NODE_GLYPH.folder}
          </button>
          <button className="qz-icon-btn" title="Add demo dataset" onClick={onDemo}>
            ✚
          </button>
          <button className="qz-icon-btn" title="Import data…" onClick={onImport}>
            ⊞
          </button>
        </div>
      </div>

      <LibraryViewSelector mode={viewMode} onChange={changeViewMode} />

      <div style={{ display: "flex", gap: 4 }}>
        <input
          className="qz-input"
          style={{ flex: 1 }}
          placeholder="⌕ Filter… (tag:… format:…)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query.trim() !== "" && (
          <button
            className="qz-icon-btn"
            title="Save this filter as a smart folder…"
            onClick={() => {
              void askParams("Save filter as smart folder", [
                { key: "name", label: "Name", type: "text", default: query.trim() },
              ]).then((p) => {
                if (p && String(p.name).trim()) addSmartFolder(String(p.name), query);
              });
            }}
          >
            ☆
          </button>
        )}
        {/* PR L (L0.48/L0.49/L0.56): "a configured filter can be saved as a
         *  virtual Collection" — the SAME query grammar/box as the smart-
         *  folder save above, saved into the new hierarchy-scoped store
         *  instead (see lib/collections.ts / CollectionsSection.tsx). */}
        {query.trim() !== "" && (
          <button
            className="qz-icon-btn"
            title="Save this filter as a Collection…"
            onClick={() => {
              void askParams("Save filter as Collection", [
                { key: "name", label: "Name", type: "text", default: query.trim() },
              ]).then((p) => {
                if (p && String(p.name).trim()) addCollection(String(p.name), query);
              });
            }}
          >
            ⊙
          </button>
        )}
      </div>

      <LibraryFocusBar
        focusedNode={libraryFocus.focusedNode}
        focusPath={libraryFocus.focusPath}
        candidateNode={libraryFocus.candidateNode}
        searching={searchActive}
        onFocus={libraryFocus.focusOn}
        onShowAll={libraryFocus.clearFocus}
      />

      {allRows.length > 0 && (
        <LibraryExplorerControls
          filter={contentFilter}
          count={libraryNodeCount(searchActive ? libraryFocus.projectHierarchy : browseHierarchy)}
          canExpand={libraryFocus.canExpand}
          canCollapse={libraryFocus.canCollapse}
          searching={searchActive}
          onFilterChange={setContentFilter}
          onExpandAll={libraryFocus.expandAll}
          onCollapseAll={libraryFocus.collapseAll}
        />
      )}

      {selectedIds.length > 1 && <MultiSelectBar />}

      <LibrarySections
        inHierarchy={inHierarchy}
        searchActive={searchActive}
        hierarchy={hierarchy}
        onFilterTag={setQuery}
        onShowInLibrary={showInLibrary}
        focusActive={libraryFocus.focusActive || contentFilter !== "all"}
      />

      {body}
      {/* MAIN #38: an empty Library is the most common launch state, so it
       *  gets the resume-work surface. `rows.length === 0` (nothing at all —
       *  no dataset/folder/workbook/figure/page/report) is the only way to
       *  reach here with no active search, since any dataset always yields
       *  at least a root worksheet row. */}
      {query.trim() === "" && allRows.length === 0 && <HomeScreen onImport={onImport} />}
      {/* Panel-width drag-resize (plan #13 sub-item 5) — a thin strip at the
       *  right edge; drag streams --lw live, release persists to qz.prefs. */}
      <div
        className="qzk-lib-resizer"
        onPointerDown={startResize}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize Library panel"
      />
    </aside>
  );
}
