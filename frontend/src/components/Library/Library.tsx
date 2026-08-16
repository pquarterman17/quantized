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

import { lazy, Suspense, useEffect, useRef, useState } from "react";

import BookFamiliesSection from "./BookFamiliesSection";
import DatasetRow from "./DatasetRow";
import FiguresSection from "./FiguresSection";
import MultiSelectBar from "./MultiSelectBar";
import OriginFidelitySection from "./OriginFidelitySection";
import ReportsSection from "./ReportsSection";
import SavedFiguresSection from "./SavedFiguresSection";
import SmartFoldersSection from "./SmartFoldersSection";
import LibraryViewSelector from "./LibraryViewSelector";
import { useLibraryHierarchyModel } from "./useLibraryHierarchyRows";
import { useLibraryResize } from "./useLibraryResize";
import { makeDemoDataset } from "../../lib/demo";
import { folderPath, folderPathLabel } from "../../lib/foldertree";
import { originSheetGroups, originSheetNumber } from "../../lib/grouping";
import HomeScreen from "./HomeScreen";
import { chooseAndImport } from "../../lib/importEntry";
import { IMPORT_ACCEPT } from "../../lib/openFilePicker";
import { matchesQuery, parseQuery } from "../../lib/smartfolders";
import {
  loadLibraryViewMode,
  saveLibraryViewMode,
  type LibraryViewMode,
} from "../../lib/libraryViewPrefs";
import type { LibraryNode, LibraryNodeKey } from "../../lib/libraryHierarchy";
import { selectLibraryNode } from "./libraryOpen";

const EditableFiguresSection = lazy(() => import("./EditableFiguresSection"));
const PagesSection = lazy(() => import("./PagesSection"));
// PR C: LibraryTree pulls in WorkbookRow/ArtifactRows/the workbook menu
// registry/FolderRow — lazy like the two sections above (MAIN_PLAN #29's
// eager-bundle budget; the pure hierarchy build itself stays eager via
// useLibraryHierarchyRows since `rows.length` drives inTree/HomeScreen).
const LibraryTree = lazy(() => import("./LibraryTree"));
const LibraryDetails = lazy(() => import("./LibraryDetails"));
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
  const revealTarget = useApp((s) => s.revealTarget);
  const clearReveal = useApp((s) => s.clearReveal);
  const startResize = useLibraryResize();
  const { hierarchy, rows } = useLibraryHierarchyModel();
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState(false);
  const [viewMode, setViewMode] = useState<LibraryViewMode>(loadLibraryViewMode);
  const pendingFocusKey = useRef<string | null>(null);
  const lastFocusedRowKey = useRef<string | null>(null);

  const changeViewMode = (next: LibraryViewMode) => {
    if (next === viewMode) return;
    const focused = document.activeElement?.closest?.("[data-lib-row], [data-ds-id]");
    const current = useApp.getState();
    const selectedKey = current.librarySelection
      ? `${current.librarySelection.kind}:${current.librarySelection.id}`
      : current.selectedIds[0]
        ? `worksheet:${current.selectedIds[0]}`
        : null;
    pendingFocusKey.current = focused?.getAttribute("data-lib-row")
      ?? (focused?.getAttribute("data-ds-id") ? `worksheet:${focused.getAttribute("data-ds-id")}` : null)
      ?? selectedKey
      ?? lastFocusedRowKey.current;

    // A Details row can select a child whose Tree ancestors are collapsed.
    // Disclose those ancestors before returning to Tree so the same current
    // item remains visible and navigable after the renderer swap.
    if (next === "tree" && pendingFocusKey.current) {
      let parentKey = hierarchy.byKey.get(pendingFocusKey.current as LibraryNodeKey)?.parentKey ?? null;
      while (parentKey) {
        const parent = hierarchy.byKey.get(parentKey);
        if (!parent) break;
        if (parent.kind === "folder" && !expandedFolders.includes(parent.entityId)) toggleFolderExpanded(parent.entityId);
        if (parent.kind === "workbook" && !expandedWorkbookIds.includes(parent.entityId)) toggleWorkbookExpanded(parent.entityId);
        parentKey = parent.parentKey;
      }
    }
    saveLibraryViewMode(next);
    setViewMode(next);
  };

  // Preserve real keyboard focus across the lazy renderer swap. A few short
  // animation-frame retries cover Suspense without introducing timers or
  // stealing focus after the user has already moved elsewhere.
  useEffect(() => {
    const key = pendingFocusKey.current;
    if (!key) return;
    let frame = 0;
    let attempts = 0;
    const tryFocus = () => {
      const selector = key.startsWith("worksheet:")
        ? `[data-ds-id="${CSS.escape(key.slice("worksheet:".length))}"]`
        : `[data-lib-row="${CSS.escape(key)}"]`;
      const target = document.querySelector(selector) as HTMLElement | null;
      if (target) {
        target.focus();
        pendingFocusKey.current = null;
      } else if (++attempts < 5) frame = requestAnimationFrame(tryFocus);
    };
    frame = requestAnimationFrame(tryFocus);
    return () => cancelAnimationFrame(frame);
  }, [viewMode, rows]);

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

  const searchActive = query.trim() !== "";
  // Body: the tree whenever there's anything to show and no active search
  // (PR C); a search query renders the PROJECT-WIDE flat Details-style
  // results surface (PR D2, L0.26) — every hierarchy node kind, full
  // breadcrumbs, normal open, per-row "Show in Library" — regardless of the
  // Tree/Details view preference (the preference governs browsing; results
  // are always the flat table).
  const inHierarchy = query.trim() === "" && rows.length > 0;
  const showInLibrary = (node: LibraryNode): void => {
    setQuery("");
    useApp.getState().requestReveal(node.key);
  };
  let body: React.ReactNode;
  if (query.trim() !== "") {
    body = (
      <Suspense fallback={null}>
        <LibraryDetails hierarchy={hierarchy} searchQuery={query} onShowInLibrary={showInLibrary} />
      </Suspense>
    );
  } else if (inHierarchy && viewMode === "details") {
    body = (
      <Suspense fallback={null}>
        <LibraryDetails hierarchy={hierarchy} />
      </Suspense>
    );
  } else if (inHierarchy) {
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
      onFocusCapture={(event) => {
        const focused = (event.target as Element).closest("[data-lib-row], [data-ds-id]");
        if (!focused) return;
        lastFocusedRowKey.current = focused.getAttribute("data-lib-row")
          ?? (focused.getAttribute("data-ds-id") ? `worksheet:${focused.getAttribute("data-ds-id")}` : null);
      }}
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
      </div>

      <MultiSelectBar />

      {/* Sections whose items are now tree children (workbook worksheets,
       *  figures, pages, reports) hide while the tree renders — and hide
       *  during search too (PR D2: the results surface covers every kind
       *  WITH the query applied; the sections were unfiltered). The
       *  true-empty state is the only remaining flat-section surface. */}
      {!inHierarchy && !searchActive && <FiguresSection />}
      {!searchActive && <OriginFidelitySection />}
      {!inHierarchy && !searchActive && <Suspense fallback={null}><EditableFiguresSection /></Suspense>}
      {!inHierarchy && !searchActive && <SavedFiguresSection />}
      {!inHierarchy && !searchActive && <Suspense fallback={null}><PagesSection /></Suspense>}
      {!inHierarchy && !searchActive && <ReportsSection />}
      {!searchActive && <BookFamiliesSection />}
      <SmartFoldersSection onFilterTag={setQuery} />

      {body}
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
