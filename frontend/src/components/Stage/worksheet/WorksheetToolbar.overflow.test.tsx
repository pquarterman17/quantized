// Worksheet audit follow-up: with a cell cursor active, the block-ops
// cluster (Block/Cut/Paste/Fill/Clear) always renders, and at common window
// widths — combined with the row/column-selection clusters — pushed the bar
// onto two lines. The groups past the edge now collapse into the "⋯" menu
// instead, same pattern as PlotToolbar (PlotToolbar.overflow.test.tsx). jsdom
// has no layout, so the bar/group widths are stubbed on the prototype
// getters the fit hook reads.

import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { preloadContextMenu } from "../../overlays/ContextMenuLazy";
import type { BlockOpsApi } from "./useWorksheetBlockOps";
import WorksheetToolbar from "./WorksheetToolbar";

beforeAll(() => preloadContextMenu());
afterEach(() => vi.restoreAllMocks());

// Natural widths of each group, keyed by its `aria-label` — measured off the
// real rendered bar (worksheet audit follow-up round 2): bundling Stats/Copy/
// Export into the never-collapsing formula group made IT alone 745px, wide
// enough to push the "⋯" button to a wrapped second line at a 1088px-class
// window even with every OTHER group already collapsed — hence the split
// below into "Formula" (still never-collapsing) and a separately collapsible
// "Actions".
const GROUP_W: Record<string, number> = {
  Formula: 526,
  Actions: 219,
  "Block operations": 230,
  "Row operations": 90,
  "Masked rows": 90,
  "Row selection": 230,
  "Column selection": 320,
  Status: 140,
};

function stubLayout(barWidth: number) {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-worksheet-toolbar") ? barWidth : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute("data-tool-group")) return GROUP_W[this.getAttribute("aria-label") ?? ""] ?? 0;
    if (this.hasAttribute("data-tool-opts")) return 32;
    return 0;
  });
}

function noopBlockOps(): BlockOpsApi {
  return {
    copyBlock: vi.fn(),
    cutBlock: vi.fn(),
    pasteBlock: vi.fn(),
    clearBlock: vi.fn(),
    fillDown: vi.fn(),
    insertRows: vi.fn(),
    deleteRows: vi.fn(),
    hasBlock: true, // a cell cursor is always "a block" of at least 1x1 (useGridCursor)
    hasRows: true,
  };
}

function baseProps() {
  return {
    formula: "",
    colName: "",
    setFormula: vi.fn(),
    setColName: vi.fn(),
    onAddColumn: vi.fn(),
    addColumnPending: false,
    showStats: false,
    onToggleStats: vi.fn(),
    onCopy: vi.fn(),
    onExport: vi.fn(),
    blockOps: noopBlockOps(),
    maskedCount: 2,
    onUnmaskAll: vi.fn(),
    selectedCount: 3,
    onExcludeSelected: vi.fn(),
    onKeepOnlySelected: vi.fn(),
    onClearSelection: vi.fn(),
    vars: "x · A · B",
    selectedColCount: 2,
    onPlotSelection: vi.fn(),
    onAddSelectionToPlot: vi.fn(),
    onOpenInGraphBuilder: vi.fn(),
    onAnalyzeSelection: vi.fn(),
    onClearColSelection: vi.fn(),
    plotLinked: true,
  };
}

describe("WorksheetToolbar — overflow menu (worksheet audit follow-up)", () => {
  it("shows every group on one line when the toolbar is wide enough", () => {
    stubLayout(2000);
    render(<WorksheetToolbar {...baseProps()} />);
    for (const name of ["Formula", "Actions", "Block operations", "Row operations", "Masked rows", "Row selection", "Column selection", "Status"]) {
      expect(screen.getByRole("group", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Add column" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "⧉ Block" })).toBeInTheDocument();
  });

  it("collapses the groups that don't fit a common width, with a cursor active, and keeps every button reachable from the ⋯ menu — never truncated", () => {
    // 1050: Formula (526) + Actions (219, Stats/Copy/Export) + Block
    // operations (230, the "extra block operation buttons" a cell cursor
    // adds) fit; Row operations and everything after do not. (jsdom resolves
    // the bar's flex `columnGap` to "" — i.e. 0 in the fit hook's own math —
    // so each admitted group only costs its own width, no added gap.)
    stubLayout(1050);
    render(<WorksheetToolbar {...baseProps()} />);
    expect(screen.getByRole("group", { name: "Formula" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Actions" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Block operations" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Row operations" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Row selection" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Column selection" })).toBeNull();
    // Not just absent from a group — absent from the bar as a top-level
    // button at all (collapsed, not rendered twice).
    expect(screen.queryByRole("button", { name: "+Rows" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Plot selection" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Toolbar options" }));
    const menu = screen.getByRole("menu");
    for (const label of ["+Rows", "−Rows", "Unmask (2)", "Exclude", "Keep only", "Deselect", "Plot selection", "Add to plot", "Graph Builder", "Analyze…", "Deselect columns"]) {
      // Full label, verbatim — collapsing hides the button; it never
      // truncates its text (no ellipsis substitute).
      expect(within(menu).getByText(label)).toBeInTheDocument();
    }
  });

  it("round 2: collapses Actions (Stats/Copy/Export) separately from the never-collapsing Formula group, at the width that used to wrap", () => {
    // 582px: Formula (526) alone fits (526+32(opts)+16(gaps)=574<=582);
    // bundled with Actions it would not (574+219+16=809) — the exact shape
    // of the live defect this round fixed (measured off a real 1088px-wide
    // window: the combined group was 745px, wider than the bar itself).
    stubLayout(582);
    render(<WorksheetToolbar {...baseProps()} />);
    expect(screen.getByRole("group", { name: "Formula" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Actions" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add column" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "⧉ Copy" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Toolbar options" }));
    expect(within(screen.getByRole("menu")).getByText("⧉ Copy")).toBeInTheDocument();
  });

  it("running a collapsed action from the ⋯ menu calls the same handler the visible button would", () => {
    stubLayout(850);
    const props = baseProps();
    render(<WorksheetToolbar {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Toolbar options" }));
    fireEvent.click(within(screen.getByRole("menu")).getByText("Plot selection"));
    expect(props.onPlotSelection).toHaveBeenCalledTimes(1);
  });

  it("falls back to showing every group when the toolbar is unmeasured (jsdom default)", () => {
    // No stubLayout: clientWidth/offsetWidth are jsdom's default 0 — the fit
    // hook must never hide anything on a guess (same rule as PlotToolbar's).
    render(<WorksheetToolbar {...baseProps()} />);
    expect(screen.getByRole("button", { name: "Plot selection" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "⧉ Block" })).toBeInTheDocument();
  });
});
