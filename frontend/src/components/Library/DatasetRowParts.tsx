// Two small pieces of a worksheet row, shared verbatim between DatasetRow's
// full card (flat/search list, Smart Folders) and its compact single-line
// Tree row (UX-001) — one file (not two) to keep the per-module bundling
// overhead down (MAIN_PLAN #29's eager-bundle budget: Library.tsx imports
// DatasetRow.tsx eagerly, so everything it imports ships eager too).
//
// `DatasetRowControls` — drag handle, "⋯" resting-cue menu button, stale
// dot, RecomputedMark, DerivedWorksheetMark, sheet chip. Markup and behavior
// are UNCHANGED from the pre-UX-001 `qzk-ds-top` — same classes, same
// titles, same drag-source contract for the plot-window rebind drop target.
//
// `DatasetRowName` — the name: a static span (double-click to rename) or the
// inline rename `<input>` when active. Both variants keep the exact same
// `.qzk-ds-name` class (LibraryTree.test.tsx queries it directly).
//
// Extracted out of DatasetRow.tsx so the compact layout doesn't duplicate
// either (DatasetRow.tsx sits at the 400-line component ceiling).

import { DATASET_DND } from "./dnd";
import DerivedWorksheetMark from "./DerivedWorksheetMark";
import RecomputedMark from "./RecomputedMark";
import { isOriginBookDataset } from "../../lib/grouping";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";

interface ControlsProps {
  dataset: Dataset;
  stale: boolean;
  onRecalc: () => void;
  /** Sheet number (>1) for a non-first sheet of a multi-sheet Origin
   *  pseudo-book group — see DatasetRow's own prop doc. */
  sheetNumber?: number;
  /** Opens the row's context menu anchored at `el` — the caller decides
   *  whether opening also selects the row first (DatasetRow.tsx: selects
   *  when not already selected, matching the pre-extraction behavior). */
  onOpenMenu: (el: HTMLElement) => void;
}

export function DatasetRowControls({ dataset: d, stale, onRecalc, sheetNumber, onOpenMenu }: ControlsProps) {
  const setActiveDrag = useApp((s) => s.setActiveDrag);
  return (
    <>
      {/* Dedicated drag handle (plan #13 sub-item 1): the ONLY
       *  draggable="true" element in the row, so a drag can only start
       *  here; the rest of the row keeps its plain select/open click. */}
      <span
        className="qzk-drag-handle"
        draggable
        tabIndex={0}
        role="button"
        aria-label="Drag to move"
        title="Drag to move"
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer.setData(DATASET_DND, d.id);
          e.dataTransfer.effectAllowed = "move";
          setActiveDrag({ kind: "dataset", id: d.id });
        }}
        onDragEnd={() => setActiveDrag(null)}
        onClick={(e) => e.stopPropagation()}
      >
        ⠿
      </span>
      {/* Resting cue (GUI_INTERACTION #8): opens the identical menu a
       *  right-click or the ContextMenu key does. */}
      <button
        className="qzk-menu-btn"
        title="More actions"
        aria-label="More actions"
        onClick={(e) => {
          e.stopPropagation();
          onOpenMenu(e.currentTarget);
        }}
      >
        ⋯
      </button>
      {stale && (
        <span
          className="qzk-stale-dot"
          title="stale — data changed; click to recalculate now"
          onClick={(e) => {
            e.stopPropagation();
            onRecalc();
          }}
        >
          ●
        </span>
      )}
      <RecomputedMark spec={d.fitSpec} stale={stale} />
      <DerivedWorksheetMark dataset={d} />
      {sheetNumber != null && (
        <span className="qzk-ds-sheet-chip" title={`Sheet ${sheetNumber} of the same Origin workbook`}>
          └ sheet {sheetNumber}
        </span>
      )}
    </>
  );
}

interface NameProps {
  dataset: Dataset;
  /** Tree-only: hide the redundant project prefix from an untouched
   *  importer-generated Origin worksheet name. */
  compactOriginName?: boolean;
  /** null = not editing; "" is a valid in-progress empty draft. */
  rename: string | null;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  onStart: () => void;
}

export function DatasetRowName({ dataset: d, compactOriginName = false, rename, onChange, onCommit, onCancel, onStart }: NameProps) {
  if (rename != null) {
    return (
      <input
        className="qz-input qzk-ds-name"
        autoFocus
        value={rename}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit();
          if (e.key === "Escape") onCancel();
        }}
      />
    );
  }
  const meta = d.data.metadata as Record<string, unknown> | undefined;
  const short = typeof meta?.origin_book === "string" ? meta.origin_book : "";
  const long = typeof meta?.origin_book_long === "string" ? meta.origin_book_long : "";
  const importedLabel = long && long !== short ? `${short} — ${long}` : short;
  const sourceBase = d.source?.path.split(/[\\/]/).pop() ?? "";
  const sourceStem = sourceBase.replace(/\.[^.]+$/, "");
  const generatedName = sourceStem && importedLabel ? `${sourceStem}:${importedLabel}` : "";
  const displayName = compactOriginName && generatedName && d.name === generatedName
    ? importedLabel
    : d.name;
  // The visible label may be shortened (Tree-only), but the ACCESSIBLE name
  // must not be: a plain <span>'s name-from-content would otherwise expose
  // the shortened text to screen readers, silently dropping the file-stem
  // context that sighted users still get from the tooltip. `aria-label`
  // outranks name-from-content and `title` in accname computation, so only
  // set it (to the full stored name) when the visible text is actually
  // shortened — the common case needs no override.
  const nameAriaLabel = displayName !== d.name ? d.name : undefined;
  return (
    <>
      {isOriginBookDataset(d) && <span className="qzk-origin-kind" title="Origin worksheet">Sheet</span>}
      <span
        className="qzk-ds-name"
        title={`${d.name} — double-click to rename`}
        aria-label={nameAriaLabel}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onStart();
        }}
      >
        {displayName}
      </span>
    </>
  );
}
