// Left panel: dataset list with sparklines. Import via the file picker or by
// dragging files onto the panel; click a row to activate. Rows can carry a group
// and tags; when any dataset has a group the list renders collapsible sections.

import { useState } from "react";

import BookFamiliesSection from "./BookFamiliesSection";
import DatasetRow from "./DatasetRow";
import FiguresSection from "./FiguresSection";
import { makeDemoDataset } from "../../lib/demo";
import {
  groupDatasets,
  groupNames,
  hasAnyGroup,
  originSheetGroups,
  originSheetNumber,
} from "../../lib/grouping";
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
  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState(""); // "" = all groups
  const [dragging, setDragging] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

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
  // clicking a tag chip, which sets the query — narrows the library to it). An
  // optional group-filter dropdown further restricts to one group.
  const q = query.toLowerCase();
  const names = groupNames(datasets);
  // A stale group filter (its group was renamed/removed) falls back to "all".
  const activeGroup = names.includes(groupFilter) ? groupFilter : "";
  const shown = datasets.filter(
    (d) =>
      (activeGroup === "" || (d.group?.trim() ?? "") === activeGroup) &&
      (d.name.toLowerCase().includes(q) ||
        (d.tags ?? []).some((t) => t.toLowerCase().includes(q))),
  );
  const grouped = hasAnyGroup(datasets);
  // Reorder is the flat manual-order tool; it operates on the global list, so it
  // only makes sense when the list isn't filtered or split into group sections.
  const canReorder = query.trim() === "" && !grouped;
  const sections = grouped ? groupDatasets(shown) : null;

  // Non-first sheets of a multi-sheet Origin pseudo-book (item ??) get a
  // subtle indent + "sheet N" chip in the row so the parent/child relation
  // reads at a glance without restructuring the list into a collapsible tree.
  // Computed off the full library (not `shown`) so filtering doesn't change it.
  const sheetOf = new Map<string, number>();
  for (const g of originSheetGroups(datasets)) {
    for (const member of g.members) {
      const n = originSheetNumber(member);
      if (n > 1) sheetOf.set(member.id, n);
    }
  }

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const row = (d: Dataset) => (
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
    />
  );

  return (
    <aside
      className={`qzk-library${dragging ? " dragover" : ""}`}
      onDragOver={(e) => {
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

      {names.length > 0 && (
        <select
          className="qz-select qzk-group-filter"
          value={activeGroup}
          onChange={(e) => setGroupFilter(e.target.value)}
          title="Filter the library to one group"
        >
          <option value="">All groups</option>
          {names.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      )}

      <FiguresSection />
      <BookFamiliesSection />

      {sections
        ? sections.map((g) => (
            <div key={g.key} className="qzk-lib-group">
              <button className="qzk-group-head" onClick={() => toggle(g.key)}>
                <span className="qzk-group-caret">{collapsed.has(g.key) ? "▸" : "▾"}</span>
                <span className="qzk-group-name">{g.label}</span>
                <span className="qzk-group-count">{g.items.length}</span>
              </button>
              {!collapsed.has(g.key) && g.items.map(row)}
            </div>
          ))
        : shown.map(row)}

      {shown.length === 0 && (
        <div className="qzk-ds-meta" style={{ padding: 8, textAlign: "center" }}>
          {datasets.length === 0
            ? "Drop files here, or use ⊞ to import / ✚ for a demo"
            : "No matches"}
        </div>
      )}
    </aside>
  );
}
