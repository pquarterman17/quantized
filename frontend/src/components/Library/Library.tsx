// Left panel: dataset list with sparklines. Import via the file picker or by
// dragging files onto the panel; click a row to activate. Datasets organize
// into a folder -> workbook -> worksheet tree (LIBRARY_WORKBOOK_UX_PLAN);
// the legacy flat `group` string is a read-only compat field only —
// migrated into folders on load (lib/foldertree.migrateGroupsToFolders),
// never rendered as its own UI here (item 6 — one organizational model).
//
// GUI_INTERACTION_PLAN #13: also hosts the multi-select bar, the panel-width
// resize handle, and the "Show in folder" reveal effect (a dataset id posted
// to the store's `revealTarget` — see store/libraryPanel.ts — is consumed
// here: clear the filter, expand the dataset's ancestor folders AND its
// workbook (PR C), select it, scroll it into view).
//
// PR C: the tree renders whenever the library has ANYTHING to show and no
// search query is active (`rows.length > 0` — post-A3 every import creates a
// workbook, so the old "only when folders exist" trigger under-fired). The
// flat section list (FiguresSection etc.) is reserved for search results and
// the true-empty state; each hides while the tree renders so nothing is
// ever a Library item twice.

import { lazy, Suspense, useEffect, useState } from "react";

import BookFamiliesSection from "./BookFamiliesSection";
import DatasetRow from "./DatasetRow";
import FiguresSection from "./FiguresSection";
import MultiSelectBar from "./MultiSelectBar";
import OriginFidelitySection from "./OriginFidelitySection";
import ReportsSection from "./ReportsSection";
import SavedFiguresSection from "./SavedFiguresSection";
import SmartFoldersSection from "./SmartFoldersSection";
import { useLibraryHierarchyRows } from "./useLibraryHierarchyRows";
import { useLibraryResize } from "./useLibraryResize";
import { makeDemoDataset } from "../../lib/demo";
import { folderPath, folderPathLabel } from "../../lib/foldertree";
import { originSheetGroups, originSheetNumber } from "../../lib/grouping";
import HomeScreen from "./HomeScreen";
import { chooseAndImport } from "../../lib/importEntry";
import { IMPORT_ACCEPT } from "../../lib/openFilePicker";
import { matchesQuery, parseQuery } from "../../lib/smartfolders";

const EditableFiguresSection = lazy(() => import("./EditableFiguresSection"));
const PagesSection = lazy(() => import("./PagesSection"));
// PR C: LibraryTree pulls in WorkbookRow/ArtifactRows/the workbook menu
// registry/FolderRow — lazy like the two sections above (MAIN_PLAN #29's
// eager-bundle budget; the pure hierarchy build itself stays eager via
// useLibraryHierarchyRows since `rows.length` drives inTree/HomeScreen).
const LibraryTree = lazy(() => import("./LibraryTree"));
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { askParams } from "../overlays/ParamDialog";

let demoSeq = 0;
const ACCEPT = IMPORT_ACCEPT;

export default function Library() {
  const datasets = useApp((s) => s.datasets);
  const activeId = useApp((s) => s.activeId);
  const selectedIds = useApp((s) => s.selectedIds);
  const addDataset = useApp((s) => s.addDataset);
  const importFiles = useApp((s) => s.importFiles);
  const folders = useApp((s) => s.folders);
  const createFolder = useApp((s) => s.createFolder);
  const addSmartFolder = useApp((s) => s.addSmartFolder);
  const expandedFolders = useApp((s) => s.expandedFolders);
  const toggleFolderExpanded = useApp((s) => s.toggleFolderExpanded);
  const expandedWorkbookIds = useApp((s) => s.expandedWorkbookIds);
  const toggleWorkbookExpanded = useApp((s) => s.toggleWorkbookExpanded);
  const selectIds = useApp((s) => s.selectIds);
  const revealTarget = useApp((s) => s.revealTarget);
  const clearReveal = useApp((s) => s.clearReveal);
  const startResize = useLibraryResize();
  const rows = useLibraryHierarchyRows();
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState(false);

  // "Show in folder" (plan #13 sub-item 2; PR C adds the workbook step): a
  // dataset id posted to `revealTarget` clears the filter, expands every
  // ancestor folder AND the dataset's own workbook that isn't already open,
  // selects the row, and scrolls it into view — then clears the signal. A
  // stale/removed dataset id just clears silently.
  useEffect(() => {
    if (!revealTarget) return;
    const id = revealTarget;
    clearReveal();
    const ds = datasets.find((d) => d.id === id);
    if (!ds) return;
    setQuery("");
    for (const f of folderPath(folders, ds.folderId ?? null)) {
      if (!expandedFolders.includes(f.id)) toggleFolderExpanded(f.id);
    }
    if (ds.workbookId && !expandedWorkbookIds.includes(ds.workbookId)) {
      toggleWorkbookExpanded(ds.workbookId);
    }
    selectIds([id]);
    requestAnimationFrame(() => {
      document.querySelector(`[data-ds-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires only on revealTarget
  }, [revealTarget]);

  // MAIN #31: routes through the shared entry point so a desktop shell gets a
  // NATIVE dialog (paths -> source.path) and a browser gets today's picker.
  const onImport = () => void chooseAndImport(useApp.getState(), ACCEPT);

  const onDemo = () => {
    const ds: Dataset = {
      id: `demo-${++demoSeq}`,
      name: `demo-vsm-${demoSeq}.dat`,
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

  // `showPath` (plan #13 sub-item 2): only the flat FILTERED list hides a
  // row's location (the tree view already shows it via nesting) — so only
  // that call site passes true.
  const row = (d: Dataset, depth = 0, showPath = false) => (
    <DatasetRow
      key={d.id}
      dataset={d}
      active={d.id === activeId}
      selected={selectedIds.includes(d.id)}
      showReorder={canReorder}
      canMoveUp={datasets.indexOf(d) > 0}
      canMoveDown={datasets.indexOf(d) < datasets.length - 1}
      onFilterTag={setQuery}
      sheetNumber={sheetOf.get(d.id)}
      depth={depth}
      folderCaption={showPath ? folderPathLabel(folders, d.folderId) : undefined}
    />
  );

  // Body: the tree whenever there's anything to show and no active search
  // (PR C); a search query always collapses to a flat filtered list.
  const inTree = query.trim() === "" && rows.length > 0;
  let body: React.ReactNode;
  if (query.trim() !== "") {
    body = shown.map((d) => row(d, 0, folders.length > 0));
  } else if (inTree) {
    body = (
      <Suspense fallback={null}>
        <LibraryTree rows={rows} onFilterTag={setQuery} />
      </Suspense>
    );
  } else {
    body = shown.map((d) => row(d));
  }

  return (
    <aside
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
    >
      <div className="qzk-lib-head">
        <span className="qzk-lib-title">Library</span>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            className="qz-icon-btn"
            title="New folder"
            onClick={() => createFolder(null, "New Folder")}
          >
            ▦
          </button>
          <button className="qz-icon-btn" title="Add demo dataset" onClick={onDemo}>
            ✚
          </button>
          <button className="qz-icon-btn" title="Import data…" onClick={onImport}>
            ⊞
          </button>
        </div>
      </div>

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
      </div>

      <MultiSelectBar />

      {/* Sections whose items are now tree children (workbook worksheets,
       *  figures, pages, reports) hide while the tree renders — search mode
       *  and the true-empty state are the only remaining flat-list surfaces. */}
      {!inTree && <FiguresSection />}
      <OriginFidelitySection />
      {!inTree && <Suspense fallback={null}><EditableFiguresSection /></Suspense>}
      {!inTree && <SavedFiguresSection />}
      {!inTree && <Suspense fallback={null}><PagesSection /></Suspense>}
      {!inTree && <ReportsSection />}
      <BookFamiliesSection />
      <SmartFoldersSection onFilterTag={setQuery} />

      {body}

      {query.trim() !== "" && shown.length === 0 && (
        <div className="qzk-ds-meta" style={{ padding: 8, textAlign: "center" }}>
          No matches
        </div>
      )}
      {/* MAIN #38: an empty Library is the most common launch state, so it
       *  gets the resume-work surface. `rows.length === 0` (nothing at all —
       *  no dataset/folder/workbook/figure/page/report) is the only way to
       *  reach here with no active search, since any dataset always yields
       *  at least a root worksheet row. */}
      {query.trim() === "" && rows.length === 0 && <HomeScreen onImport={onImport} />}
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
