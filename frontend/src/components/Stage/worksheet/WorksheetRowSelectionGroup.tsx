// The toolbar's "Row selection" cluster (#50): bulk actions on the selected rows, as inline buttons
// and as the same actions again for the "⋯" overflow menu (labels verbatim). The gutter menu
// (./rowSelectionMenu.ts) offers the same set over the same callbacks.

import type { ContextMenuItem } from "../../overlays/ContextMenu";

export interface RowSelectionGroupProps {
  selectedCount: number;
  onExcludeSelected: () => void;
  onKeepOnlySelected: () => void;
  onClearSelection: () => void;
  /** "Extract selected rows to a new sheet" (the same Extract path as the filter bar's). */
  onExtractSelected: () => void;
  /** Why "Use as row range" is unavailable (the selection has gaps); null for one block. */
  rowRangeReason: string | null;
  /** `"plot"`: the focused plot draws only these rows, rather than an analysis reading them. */
  onUseAsRowRange: (into?: "plot") => void;
}

const btnItem = (label: string, run: () => void, disabled?: boolean): ContextMenuItem => ({ label, run, disabled });

export function rowSelectionGroup(p: RowSelectionGroupProps): { label: string; node: React.ReactNode; items: ContextMenuItem[] } {
  const { selectedCount, onExcludeSelected, onKeepOnlySelected, onClearSelection, onExtractSelected, rowRangeReason, onUseAsRowRange } = p;
  return {
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
        <button className="qz-btn" onClick={() => onUseAsRowRange()} disabled={rowRangeReason !== null} title={rowRangeReason ? `Use as row range: ${rowRangeReason}` : "Limit an analysis to these rows (a contiguous block)"}>
          Use as row range
        </button>
        <button className="qz-btn" onClick={() => onUseAsRowRange("plot")} disabled={rowRangeReason !== null} title={rowRangeReason ? `Plot only these rows: ${rowRangeReason}` : "Draw only these rows on the plot (a contiguous block); clear it from the chip on the plot"}>
          Plot only these rows
        </button>
        <button className="qz-btn" onClick={onExtractSelected} title="Copy the selected rows into a new worksheet that remembers its source rows">
          Extract selected rows to a new sheet
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
      btnItem("Use as row range", () => onUseAsRowRange(), rowRangeReason !== null),
      btnItem("Plot only these rows", () => onUseAsRowRange("plot"), rowRangeReason !== null),
      btnItem("Extract selected rows to a new sheet", onExtractSelected),
      btnItem("Deselect", onClearSelection),
    ],
  };
}
