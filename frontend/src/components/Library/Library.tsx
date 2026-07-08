// Left panel: dataset list with sparklines. Import via the file picker or by
// dragging files onto the panel; click a row to activate. Datasets organize
// into a folder tree (project-organization plan); the legacy flat `group`
// string is a read-only compat field only — migrated into folders on load
// (lib/foldertree.migrateGroupsToFolders), never rendered as its own UI here
// (item 6 — one organizational model, not two).

import { useState } from "react";

import BookFamiliesSection from "./BookFamiliesSection";
import DatasetRow from "./DatasetRow";
import FigureRow from "./FigureRow";
import FiguresSection from "./FiguresSection";
import FolderRow from "./FolderRow";
import ReportsSection from "./ReportsSection";
import SavedFiguresSection from "./SavedFiguresSection";
import { useLibraryTree } from "./useLibraryTree";
import { makeDemoDataset } from "../../lib/demo";
import { originSheetGroups, originSheetNumber } from "../../lib/grouping";
import { IMPORT_ACCEPT, openFilePicker } from "../../lib/openFilePicker";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";

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
  const treeRows = useLibraryTree();
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState(false);

  const onImport = () => openFilePicker((files) => void importFiles(files), ACCEPT);

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

  // Filter matches the dataset name OR any of its tags (so typing a tag — or
  // clicking a tag chip, which sets the query — narrows the library to it).
  const q = query.toLowerCase();
  const shown = datasets.filter(
    (d) =>
      d.name.toLowerCase().includes(q) || (d.tags ?? []).some((t) => t.toLowerCase().includes(q)),
  );
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

  const row = (d: Dataset, depth = 0) => (
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
    />
  );

  // Body: a folder tree when folders exist (and no active search), else the
  // flat list. A search query always collapses to a flat filtered list.
  const inTree = query.trim() === "" && folders.length > 0;
  let body: React.ReactNode;
  if (query.trim() !== "") {
    body = shown.map((d) => row(d));
  } else if (inTree) {
    body = treeRows.map((r) => {
      if (r.kind === "folder")
        return (
          <FolderRow
            key={r.id}
            folder={r.folder}
            depth={r.depth}
            count={r.count}
            expanded={r.expanded}
          />
        );
      if (r.kind === "figure") return <FigureRow key={r.id} entry={r.entry} depth={r.depth} />;
      return row(r.dataset, r.depth);
    });
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

      <input
        className="qz-input"
        placeholder="⌕ Filter…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {!inTree && <FiguresSection />}
      <SavedFiguresSection />
      <ReportsSection />
      <BookFamiliesSection />

      {body}

      {shown.length === 0 && folders.length === 0 && (
        <div className="qzk-ds-meta" style={{ padding: 8, textAlign: "center" }}>
          {datasets.length === 0
            ? "Drop files here, or use ⊞ to import / ✚ for a demo"
            : "No matches"}
        </div>
      )}
    </aside>
  );
}
