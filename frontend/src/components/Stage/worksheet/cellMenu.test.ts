// UX audit 10 (P1-5): the worksheet cell menu's Cut / Copy / Paste / Clear
// contents / Fill down group, and the header menu's reasons for the X column.

import { describe, expect, it, vi } from "vitest";

import { columnViewItems, type ColumnViewControls } from "./columnViewMenu";
import { cellBlockItems } from "./cellMenu";
import { columnEditItems, type ColumnEditContext } from "./worksheetEditMenus";
import type { BlockOpsApi } from "./useWorksheetBlockOps";
import type { ContextMenuItem } from "../../overlays/ContextMenu";

type Entry = { label: string; run: () => void; disabled?: boolean; title?: string; shortcutLabel?: string; danger?: boolean };
const entries = (items: ContextMenuItem[]): Entry[] => items.filter((i) => "label" in i && "run" in i) as Entry[];
const named = (items: ContextMenuItem[], label: string): Entry => entries(items).find((e) => e.label === label)!;

const ops = (over: Partial<BlockOpsApi> = {}): BlockOpsApi => ({
  copyBlock: vi.fn(),
  cutBlock: vi.fn(),
  pasteBlock: vi.fn(),
  clearBlock: vi.fn(),
  fillDown: vi.fn(),
  insertRows: vi.fn(),
  deleteRows: vi.fn(),
  hasBlock: true,
  hasRows: true,
  ...over,
});

describe("cellBlockItems", () => {
  it("offers Cut, Copy, Paste, Clear contents and Fill down, each running its block operation", () => {
    const o = ops();
    const items = cellBlockItems({ ops: o }, false);
    expect(entries(items).map((e) => e.label)).toEqual(["Cut", "Copy", "Paste", "Clear contents", "Fill down"]);
    for (const [label, fn] of [["Cut", o.cutBlock], ["Copy", o.copyBlock], ["Paste", o.pasteBlock], ["Clear contents", o.clearBlock], ["Fill down", o.fillDown]] as const) {
      named(items, label).run();
      expect(fn, label).toHaveBeenCalledOnce();
    }
  });

  it("shows the platform's shortcuts", () => {
    expect(named(cellBlockItems({ ops: ops() }, false), "Copy").shortcutLabel).toBe("Ctrl+C");
    expect(named(cellBlockItems({ ops: ops() }, true), "Paste").shortcutLabel).toBe("⌘V");
  });

  it("with no cells selected disables what needs a selection, with a reason; Paste stays live", () => {
    const items = cellBlockItems({ ops: ops({ hasBlock: false }) }, false);
    for (const label of ["Cut", "Copy", "Clear contents", "Fill down"]) {
      expect(named(items, label).disabled, label).toBe(true);
      expect(named(items, label).title, label).toBe("select cells first");
    }
    expect(named(items, "Paste").disabled).toBe(false);
  });

  it("on a read-only sheet disables every editing entry with the sheet's reason, but not Copy", () => {
    const items = cellBlockItems({ ops: ops(), readOnlyReason: "re-derived: edit the source" }, false);
    for (const label of ["Cut", "Paste", "Clear contents", "Fill down"]) {
      expect(named(items, label).disabled, label).toBe(true);
      expect(named(items, label).title, label).toBe("re-derived: edit the source");
    }
    expect(named(items, "Copy").disabled).toBe(false);
  });
});

describe("column header menu reasons", () => {
  const controls = (over: Partial<ColumnViewControls> = {}): ColumnViewControls => ({
    labels: ["A", "B"],
    hidden: [],
    frozen: 0,
    selected: [],
    hide: vi.fn(),
    show: vi.fn(),
    freezeThrough: vi.fn(),
    unfreeze: vi.fn(),
    ...over,
  });

  it("a right-clicked value column is the target even with nothing selected", () => {
    const c = controls();
    const items = columnViewItems(c, [1]);
    expect(named(items, "Hide column").disabled).toBe(false);
    named(items, "Hide column").run();
    expect(c.hide).toHaveBeenCalledWith([1]);
    const freeze = entries(items).find((e) => e.label.startsWith("Freeze through"))!;
    expect(freeze.label).toBe('Freeze through "B"');
    expect(freeze.disabled).toBe(false);
  });

  it("on the X column says why, instead of asking for a selection that was already made", () => {
    const items = columnViewItems(controls(), [-1]);
    expect(named(items, "Hide column").disabled).toBe(true);
    expect(named(items, "Hide column").title).toBe("the X column is always shown");
    expect(named(items, "Freeze through column").title).toBe("the X column is always pinned");
  });

  it("the toolbar (no target) still asks for a selection", () => {
    const items = columnViewItems(controls());
    expect(named(items, "Hide column").title).toBe("select a column first");
  });

  it("a disabled Delete column is not styled as a live danger", () => {
    const ctx = { baseCount: 2, targets: [-1], editHeader: vi.fn(), setColumnValues: vi.fn(), numberFormat: vi.fn(), insertColumn: vi.fn(), addColumn: vi.fn(), deleteColumns: vi.fn(), moveColumn: vi.fn(), sortWorksheet: vi.fn(), fill: vi.fn(), setRowCount: vi.fn() } as ColumnEditContext;
    const onX = named(columnEditItems(-1, ctx), "Delete column");
    expect(onX.disabled).toBe(true);
    expect(onX.danger).toBe(false);
    const onY = named(columnEditItems(0, { ...ctx, targets: [0] }), "Delete column");
    expect(onY.disabled).toBeFalsy();
    expect(onY.danger).toBe(true);
  });
});
