// worksheetMenus — pins the GUI_INTERACTION #8 retrofit's output: the
// registry-composed columnMenuItems/rowMenuItems must still produce the
// EXACT label/order/separator/disabled shape the original hand-built
// version did (see the module's own header note).

import { describe, expect, it, vi } from "vitest";

import type { ContextMenuItem } from "../../overlays/ContextMenu";
import { columnMenuItems, rowMenuItems, type ColumnMenuContext, type RowMenuContext } from "./worksheetMenus";

function labelsOf(items: ContextMenuItem[]): string[] {
  return items.map((i) => ("separator" in i ? "—sep—" : "label" in i ? i.label : "?"));
}

function makeColCtx(over: Partial<ColumnMenuContext> = {}): ColumnMenuContext {
  return {
    xKey: null,
    yKeys: null,
    labelCount: 4,
    setXKey: vi.fn(),
    setYKeys: vi.fn(),
    sortAsc: vi.fn(),
    sortDesc: vi.fn(),
    onNewColumn: vi.fn(),
    showStats: false,
    onToggleStats: vi.fn(),
    onPlotSelection: vi.fn(),
    onAddSelectionToPlot: vi.fn(),
    onOpenInGraphBuilder: vi.fn(),
    ...over,
  };
}

describe("worksheetMenus — columnMenuItems", () => {
  it("col = -1 (the x column): sort only, no set-X/plot-toggle block", () => {
    const items = columnMenuItems(-1, makeColCtx());
    expect(labelsOf(items)).toEqual([
      "Sort ascending",
      "Sort descending",
      "—sep—",
      "Plot selection",
      "Add selection to plot",
      "Open in Graph Builder…",
      "—sep—",
      "New column from formula…",
      "Show column statistics",
    ]);
  });

  it("col >= 0 inserts the set-X/plot-toggle block with its own leading separator", () => {
    // yKeys: null defaults to "all channels plotted" (see plottedCols), so a
    // real column with no explicit yKeys starts out shown -> "Hide from plot".
    const items = columnMenuItems(2, makeColCtx());
    expect(labelsOf(items)).toEqual([
      "Sort ascending",
      "Sort descending",
      "—sep—",
      "Set as X axis",
      "Hide from plot",
      "—sep—",
      "Plot selection",
      "Add selection to plot",
      "Open in Graph Builder…",
      "—sep—",
      "New column from formula…",
      "Show column statistics",
    ]);
  });

  it("col = 2 with xKey = 2: 'Already the X axis', disabled", () => {
    const items = columnMenuItems(2, makeColCtx({ xKey: 2 }));
    const setX = items.find((i) => "label" in i && i.label.includes("X axis")) as { label: string; disabled?: boolean };
    expect(setX.label).toBe("Already the X axis");
    expect(setX.disabled).toBe(true);
  });

  it("col = 2 with xKey = null: 'Set as X axis', enabled", () => {
    const items = columnMenuItems(2, makeColCtx({ xKey: null }));
    const setX = items.find((i) => "label" in i && i.label.includes("X axis")) as { label: string; disabled?: boolean };
    expect(setX.label).toBe("Set as X axis");
    expect(setX.disabled).toBeFalsy();
  });

  it("a plotted col that is the ONLY plotted col: 'Hide from plot' disabled", () => {
    const items = columnMenuItems(1, makeColCtx({ yKeys: [1] }));
    const toggle = items.find((i) => "label" in i && (i.label === "Hide from plot" || i.label === "Plot as Y")) as {
      label: string;
      disabled?: boolean;
    };
    expect(toggle.label).toBe("Hide from plot");
    expect(toggle.disabled).toBe(true);
  });

  it("a plotted col with 2+ plotted total: 'Hide from plot' enabled", () => {
    const items = columnMenuItems(1, makeColCtx({ yKeys: [1, 2] }));
    const toggle = items.find((i) => "label" in i && i.label === "Hide from plot") as { disabled?: boolean };
    expect(toggle.disabled).toBeFalsy();
  });

  it("an unplotted col: 'Plot as Y', never disabled", () => {
    const items = columnMenuItems(3, makeColCtx({ yKeys: [1, 2] }));
    const toggle = items.find((i) => "label" in i && i.label === "Plot as Y") as { disabled?: boolean };
    expect(toggle).toBeTruthy();
    expect(toggle.disabled).toBeFalsy();
  });

  it("Show/Hide column statistics reflects ctx.showStats", () => {
    expect(labelsOf(columnMenuItems(0, makeColCtx({ showStats: false })))).toContain("Show column statistics");
    expect(labelsOf(columnMenuItems(0, makeColCtx({ showStats: true })))).toContain("Hide column statistics");
  });

  it("Plot as Y adds the column and re-sorts ascending", () => {
    const setYKeys = vi.fn();
    const items = columnMenuItems(0, makeColCtx({ yKeys: [3, 1], setYKeys }));
    const toggle = items.find((i) => "label" in i && i.label === "Plot as Y") as { run: () => void };
    toggle.run();
    expect(setYKeys).toHaveBeenCalledWith([0, 1, 3]);
  });

  it("Hide from plot removes just the clicked column", () => {
    const setYKeys = vi.fn();
    const items = columnMenuItems(1, makeColCtx({ yKeys: [0, 1, 2], setYKeys }));
    const toggle = items.find((i) => "label" in i && i.label === "Hide from plot") as { run: () => void };
    toggle.run();
    expect(setYKeys).toHaveBeenCalledWith([0, 2]);
  });
});

function makeRowCtx(over: Partial<RowMenuContext> = {}): RowMenuContext {
  return {
    masked: new Set<number>(),
    toggleMask: vi.fn(),
    unmaskAll: vi.fn(),
    copyRow: vi.fn(),
    ...over,
  };
}

describe("worksheetMenus — rowMenuItems", () => {
  it("an unmasked row: 'Mask row', 'Unmask all rows' disabled (nothing masked)", () => {
    const items = rowMenuItems(0, makeRowCtx());
    expect(labelsOf(items)).toEqual(["Mask row", "Unmask all rows", "—sep—", "Copy row (TSV)"]);
    const unmaskAll = items.find((i) => "label" in i && i.label === "Unmask all rows") as { disabled?: boolean };
    expect(unmaskAll.disabled).toBe(true);
  });

  it("a masked row: 'Unmask row', 'Unmask all rows' enabled", () => {
    const items = rowMenuItems(2, makeRowCtx({ masked: new Set([2]) }));
    expect(labelsOf(items)[0]).toBe("Unmask row");
    const unmaskAll = items.find((i) => "label" in i && i.label === "Unmask all rows") as { disabled?: boolean };
    expect(unmaskAll.disabled).toBeFalsy();
  });

  it("Copy row (TSV) calls ctx.copyRow with the row index", () => {
    const copyRow = vi.fn();
    const items = rowMenuItems(5, makeRowCtx({ copyRow }));
    const copy = items.find((i) => "label" in i && i.label === "Copy row (TSV)") as { run: () => void };
    copy.run();
    expect(copyRow).toHaveBeenCalledWith(5);
  });
});
