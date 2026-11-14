// Presentational toolbar for the Worksheet: the computed-column formula bar plus
// the Stats / Copy / Unmask actions, the row-selection (#50) bulk-action cluster,
// and (WORKSHEET_PLAN items 6+7) the column-selection "Plot selection"/"Add to
// plot" cluster. All state lives in the parent (Worksheet); this is a thin
// props-driven view so the worksheet stays under the size budget.
//
// Overflow (worksheet audit follow-up): a cell cursor is always "a block" of
// at least 1x1 to `useGridCursor`'s own block ops, so the five block-op
// buttons below render essentially any time the grid has focus — combined
// with the row/column-selection clusters, that routinely pushed the bar onto
// a second line at common window widths. The clusters past "Edit" (the
// always-visible formula bar + the everyday Stats/Copy/Export actions) are
// grouped and fitted on demand (useWorksheetToolbarFit, PlotToolbar's own
// `fitToolGroups`): as many as fit stay inline, least-common-first; the rest
// collapse into the "⋯" menu, in full — never truncated.

import { useRef, useState } from "react";

import ContextMenu, { type ContextMenuItem } from "../../overlays/ContextMenu";
import type { BlockOpsApi } from "./useWorksheetBlockOps";
import { useWorksheetToolbarFit } from "./worksheetToolbarOverflow";

// JMP_GAP J11 formula language v2 quick reference — the hover tooltip on the
// ƒx bar. Full grammar/NaN-propagation rules live in lib/formula.ts's module
// header (the authoritative doc, since it can't drift from the parser);
// this is the compact user-facing cheat sheet.
const FORMULA_HELP = [
  "Operators: + - * / // % ^ **   Comparisons: < <= > >= == !=   Logic: and or not",
  "Functions: sin cos tan asin acos atan atan2 sinh cosh tanh exp log log10 log2 sqrt abs sign floor ceil hypot pow min max",
  "if(cond, a, b), where, or cond ? a : b — NaN cond -> NaN · fit(\"Model\", \"A\") fitval(\"Model\", x)",
  "Aggregates (scalar, same value every row): mean(A) sd(A) min(A) max(A) median(A) sum(A) count(A) — over rows i..j: sum(A[i:j])",
  "Row: row() is 1-based · A[i] = row i (1-based) · lag(A, k) — NaN past the edge · diff(A) = A - lag(A, 1) · cumsum(A)",
  "Variables: x and the channel letters A, B, C, … · col(A) · col(\"Long Name\") · another sheet: sheet(\"Name\", A)",
  "Text: B == \"label\" (categorical) · col(\"Text column\") != \"a\" — == and != only",
].join("\n");

export interface WorksheetToolbarProps {
  formula: string;
  colName: string;
  setFormula: (v: string) => void;
  setColName: (v: string) => void;
  /** P2.5: `errors` = also derive + bind a propagated-uncertainty column
   *  (the "± errors" toggle, local to this bar). */
  onAddColumn: (errors: boolean) => void;
  /** #6: an add is in flight — disable submit and ignore Enter, so a rapid
   *  repeat doesn't add the same column twice before the box clears. */
  addColumnPending: boolean;
  showStats: boolean;
  onToggleStats: () => void;
  onCopy: () => void;
  /** "Export…": this sheet (or its selected rows) as CSV / TSV / Excel. */
  onExport: () => void;
  /** MAIN #34 block ops — shown only when a row×column block is selected. */
  blockOps: BlockOpsApi;
  maskedCount: number;
  onUnmaskAll: () => void;
  /** #50 selection dimension: bulk actions on the selected rows. */
  selectedCount: number;
  onExcludeSelected: () => void;
  onKeepOnlySelected: () => void;
  onClearSelection: () => void;
  vars: string;
  /** Column selection → plot (items 6 + 7): the "Origin gesture" toolbar
   *  affordances, shown only while at least one column is selected. */
  selectedColCount: number;
  onPlotSelection: () => void;
  onAddSelectionToPlot: () => void;
  /** Selection → Graph Builder handoff (MAIN_PLAN #4) — same cluster, so it
   *  is only offered (and thus never enabled) with a non-empty selection. */
  onOpenInGraphBuilder: () => void;
  onAnalyzeSelection: () => void;
  onClearColSelection: () => void;
  /** GUI_INTERACTION #14: is THIS worksheet linked to the live plot (row
   *  selection highlights plotted points; "Set As › X"/"Plot as Y" edit it
   *  directly)? Shown as an explicit badge — never a silent assumption. */
  plotLinked: boolean;
}

/** One toolbar cluster: its rendered buttons, and the SAME actions again as
 *  menu items for when it collapses into "⋯" — label text matches verbatim,
 *  so a collapsed action is never a shortened stand-in for the real button. */
interface ToolbarGroup {
  label: string;
  node: React.ReactNode;
  items: ContextMenuItem[];
}

const btnItem = (label: string, run: () => void, disabled?: boolean): ContextMenuItem => ({ label, run, disabled });

export default function WorksheetToolbar({
  formula,
  colName,
  setFormula,
  setColName,
  onAddColumn,
  addColumnPending,
  showStats,
  onToggleStats,
  onCopy,
  onExport,
  blockOps,
  maskedCount,
  onUnmaskAll,
  selectedCount,
  onExcludeSelected,
  onKeepOnlySelected,
  onClearSelection,
  vars,
  selectedColCount,
  onPlotSelection,
  onAddSelectionToPlot,
  onOpenInGraphBuilder,
  onAnalyzeSelection,
  onClearColSelection,
  plotLinked,
}: WorksheetToolbarProps) {
  const [propagate, setPropagate] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const optsBtnRef = useRef<HTMLButtonElement>(null);
  const [optsFlyout, setOptsFlyout] = useState<{ x: number; y: number } | null>(null);

  // Order matters: groups collapse from the END, so "Edit" (the formula bar
  // + everyday actions) is never the one to go.
  const groups: ToolbarGroup[] = [
    {
      label: "Edit",
      node: (
        <>
          <span className="qzk-field-lbl" style={{ margin: 0 }}>
            ƒx
          </span>
          <input
            className="qz-input"
            aria-label="Formula"
            placeholder="2*A + sqrt(B)"
            title={FORMULA_HELP}
            value={formula}
            onChange={(e) => setFormula(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && formula.trim() && !addColumnPending && onAddColumn(propagate)}
            style={{ width: 200 }}
          />
          <input
            className="qz-input"
            aria-label="New column name"
            placeholder="column name"
            value={colName}
            onChange={(e) => setColName(e.target.value)}
            style={{ width: 120 }}
          />
          <button
            className={propagate ? "qz-btn qz-active" : "qz-btn"}
            aria-pressed={propagate}
            onClick={() => setPropagate(!propagate)}
            title="Also add a bound σ column (first-order)"
          >
            ± errors
          </button>
          <button className="qz-btn" disabled={!formula.trim() || addColumnPending} onClick={() => onAddColumn(propagate)}>
            Add column
          </button>
          <button className={showStats ? "qz-btn qz-active" : "qz-btn"} aria-pressed={showStats} onClick={onToggleStats} title="Per-column statistics">
            Σ Stats
          </button>
          <button className="qz-btn" onClick={onCopy} title="Copy visible rows to clipboard (TSV)">
            ⧉ Copy
          </button>
          <button className="qz-btn" onClick={onExport} title="Save this worksheet (or its selected rows) as CSV, TSV or Excel, with Long Name and Units rows">
            ⇩ Export…
          </button>
        </>
      ),
      items: [], // never collapses in practice (always group 0) — nothing to offer
    },
  ];

  // MAIN #34: rectangular + row operations — a cell cursor's own 1x1 "block"
  // (useGridCursor) makes these the common case, not the rare one, which is
  // exactly why they're first to collapse rather than exempt from it.
  if (blockOps.hasBlock) {
    groups.push({
      label: "Block operations",
      node: (
        <>
          <button className="qz-btn" onClick={blockOps.copyBlock} title="Copy the selected block (no header, pastes back cleanly)">
            ⧉ Block
          </button>
          <button className="qz-btn" onClick={blockOps.cutBlock} title="Copy the selected block, then blank it (⌘X)">
            Cut
          </button>
          <button className="qz-btn" onClick={blockOps.pasteBlock} title="Paste clipboard cells at the top-left of the selection (⌘V)">
            Paste
          </button>
          <button className="qz-btn" onClick={blockOps.fillDown} title="Copy the top selected row down the rest of the selection">
            Fill ↓
          </button>
          <button className="qz-btn" onClick={blockOps.clearBlock} title="Blank every selected cell (undoable)">
            Clear
          </button>
        </>
      ),
      items: [
        btnItem("⧉ Block", blockOps.copyBlock),
        btnItem("Cut", blockOps.cutBlock),
        btnItem("Paste", blockOps.pasteBlock),
        btnItem("Fill ↓", blockOps.fillDown),
        btnItem("Clear", blockOps.clearBlock),
      ],
    });
  }
  if (blockOps.hasRows) {
    groups.push({
      label: "Row operations",
      node: (
        <>
          <button className="qz-btn" onClick={blockOps.insertRows} title="Insert blank rows above the selection">
            +Rows
          </button>
          <button className="qz-btn" onClick={blockOps.deleteRows} title="Delete the selected rows (undoable; exclusions are remapped)">
            −Rows
          </button>
        </>
      ),
      items: [btnItem("+Rows", blockOps.insertRows), btnItem("−Rows", blockOps.deleteRows)],
    });
  }
  if (maskedCount > 0) {
    groups.push({
      label: "Masked rows",
      node: (
        <button className="qz-btn" onClick={onUnmaskAll} title="Clear all masked rows">
          Unmask ({maskedCount})
        </button>
      ),
      items: [btnItem(`Unmask (${maskedCount})`, onUnmaskAll)],
    });
  }
  if (selectedCount > 0) {
    groups.push({
      label: "Row selection",
      node: (
        <>
          <span className="qzk-ds-meta" style={{ color: "var(--accent)" }}>
            {selectedCount} selected
          </span>
          <button className="qz-btn" onClick={onExcludeSelected} title="Mask the selected rows (exclude from analysis)">
            Exclude
          </button>
          <button className="qz-btn" onClick={onKeepOnlySelected} title="Mask every row except the selected ones">
            Keep only
          </button>
          <button className="qz-btn" onClick={onClearSelection} title="Clear the selection">
            Deselect
          </button>
        </>
      ),
      items: [
        { header: `${selectedCount} selected` },
        btnItem("Exclude", onExcludeSelected),
        btnItem("Keep only", onKeepOnlySelected),
        btnItem("Deselect", onClearSelection),
      ],
    });
  }
  if (selectedColCount > 0) {
    const colWord = `${selectedColCount} column${selectedColCount === 1 ? "" : "s"} selected`;
    groups.push({
      label: "Column selection",
      node: (
        <>
          <span className="qzk-ds-meta" style={{ color: "var(--accent)" }}>
            {colWord}
          </span>
          <button className="qz-btn" onClick={onPlotSelection} title="Plot the selected columns (designation-aware — replaces the current Y set)">
            Plot selection
          </button>
          <button className="qz-btn" onClick={onAddSelectionToPlot} title="Add the selected columns to the current plot">
            Add to plot
          </button>
          <button className="qz-btn" onClick={onOpenInGraphBuilder} title="Open the selected columns in the Graph Builder (prefills the X/Y wells)">
            Graph Builder
          </button>
          <button className="qz-btn" onClick={onAnalyzeSelection} title="Review these columns and rows in the Analysis Center">
            Analyze…
          </button>
          <button className="qz-btn" onClick={onClearColSelection} title="Clear the column selection">
            Deselect columns
          </button>
        </>
      ),
      items: [
        { header: colWord },
        btnItem("Plot selection", onPlotSelection),
        btnItem("Add to plot", onAddSelectionToPlot),
        btnItem("Graph Builder", onOpenInGraphBuilder),
        btnItem("Analyze…", onAnalyzeSelection),
        btnItem("Deselect columns", onClearColSelection),
      ],
    });
  }
  if (plotLinked || vars) {
    groups.push({
      label: "Status",
      node: (
        <>
          {plotLinked && (
            <span
              className="qzk-ds-meta"
              style={{ color: "var(--accent)" }}
              title="This worksheet's dataset is the live plot's — row selection highlights plotted points, and Set As › X / Plot as Y edit it directly"
            >
              ⧟ Linked to plot
            </span>
          )}
          <span className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
            vars: {vars}
          </span>
        </>
      ),
      items: [
        ...(plotLinked ? [{ header: "⧟ Linked to plot" }] : []),
        { header: `vars: ${vars}` },
      ],
    });
  }

  const visible = useWorksheetToolbarFit(barRef, groups.length, groups.length);
  const overflowItems: ContextMenuItem[] = groups.slice(visible).flatMap((g, i) => [
    ...(i > 0 ? [{ separator: true as const }] : []),
    ...(g.items.length ? g.items : [{ header: g.label }]),
  ]);

  return (
    <div
      ref={barRef}
      data-worksheet-toolbar=""
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 8px",
        borderBottom: "1px solid var(--border, #333)",
        flexWrap: "wrap",
        position: "relative",
      }}
    >
      {groups.map((g, i) => (
        <div
          key={g.label}
          role="group"
          aria-label={g.label}
          data-tool-group=""
          style={
            i >= visible
              ? { position: "absolute", top: 0, left: 0, visibility: "hidden", pointerEvents: "none" }
              : { display: "flex", alignItems: "center", gap: 8 }
          }
        >
          {g.node}
        </div>
      ))}
      <button
        ref={optsBtnRef}
        className="qz-btn"
        aria-label="Toolbar options"
        data-tool-opts=""
        disabled={visible >= groups.length}
        title={visible < groups.length ? "More worksheet actions that don't fit this window" : "Toolbar options"}
        onClick={() => {
          const r = optsBtnRef.current?.getBoundingClientRect();
          setOptsFlyout(r ? { x: r.left, y: r.bottom + 4 } : { x: 0, y: 0 });
        }}
      >
        ⋯
      </button>
      {optsFlyout && <ContextMenu x={optsFlyout.x} y={optsFlyout.y} items={overflowItems} onClose={() => setOptsFlyout(null)} />}
    </div>
  );
}
