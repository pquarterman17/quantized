// UX9-J: Edit > Cut / Copy / Delete dispatch to the existing per-focus
// behaviour and are disabled WITH a reason when nothing applies.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BlockOpsApi } from "../components/Stage/worksheet/useWorksheetBlockOps";
import { publishSheetBlockOps } from "../lib/editTargets";
import { useApp } from "../store/useApp";
import { buildEditClipboardCommands } from "./editClipboardCommands";

const get = (id: string) => {
  const a = buildEditClipboardCommands(useApp.getState).find((c) => c.id === id);
  if (!a) throw new Error(id);
  return a;
};
const isDisabled = (id: string) => {
  const d = get(id).disabled;
  return typeof d === "function" ? d() : Boolean(d);
};

function ops(hasBlock: boolean): BlockOpsApi {
  return {
    copyBlock: vi.fn(), cutBlock: vi.fn(), pasteBlock: vi.fn(), clearBlock: vi.fn(),
    fillDown: vi.fn(), insertRows: vi.fn(), deleteRows: vi.fn(), hasBlock, hasRows: false,
  };
}

let registered: BlockOpsApi | null = null;
let unpublish: (() => void) | null = null;
let root: HTMLElement;
/** Publish `o` as a worksheet pane and point into it (the user working in the sheet). */
function publish(o: BlockOpsApi): void {
  registered = o;
  unpublish = publishSheetBlockOps(root, () => o);
  inside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
}
let inside: HTMLElement;
let outside: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '<div id="root"><span id="in"></span></div><div id="plot"></div>';
  root = document.getElementById("root") as HTMLElement;
  inside = document.getElementById("in") as HTMLElement;
  outside = document.getElementById("plot") as HTMLElement;
  useApp.setState({ datasets: [], activeId: null, selectedIds: [], selectedAnnotationId: null, selectedShapeId: null });
});
afterEach(() => {
  unpublish?.();
  unpublish = null;
  registered = null;
});

describe("Edit > Cut / Copy / Delete", () => {
  it("are all disabled, with a reason, when nothing applies", () => {
    for (const id of ["edit-cut", "edit-copy", "edit-delete"]) {
      expect(isDisabled(id)).toBe(true);
      const r = get(id).disabledReason;
      expect(typeof r === "string" ? r : r?.()).toBeTruthy();
    }
  });

  it("cut / copy / delete drive the worksheet block ops when a block is selected", () => {
    publish(ops(true));
    expect(isDisabled("edit-copy")).toBe(false);
    get("edit-copy").run();
    get("edit-cut").run();
    get("edit-delete").run();
    expect(registered?.copyBlock).toHaveBeenCalledTimes(1);
    expect(registered?.cutBlock).toHaveBeenCalledTimes(1);
    expect(registered?.clearBlock).toHaveBeenCalledTimes(1);
  });

  it("a stale cell selection stops being the target once the user works elsewhere", () => {
    publish(ops(true));
    expect(isDisabled("edit-delete")).toBe(false);
    outside.dispatchEvent(new Event("pointerdown", { bubbles: true })); // the plot / Library
    expect(isDisabled("edit-copy")).toBe(true);
    expect(isDisabled("edit-delete")).toBe(true); // nothing else selected
    get("edit-delete").run();
    expect(registered?.clearBlock).not.toHaveBeenCalled();
  });

  it("opening a menu (role=menu) does not drop the sheet target; unmounting does", () => {
    publish(ops(true));
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    document.body.append(menu);
    menu.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(isDisabled("edit-copy")).toBe(false);
    unpublish?.();
    expect(isDisabled("edit-copy")).toBe(true);
  });

  it("a sheet with no block does not enable Cut / Copy", () => {
    publish(ops(false));
    expect(isDisabled("edit-copy")).toBe(true);
    expect(isDisabled("edit-cut")).toBe(true);
  });

  it("Delete removes the selected Library datasets through the shared request path", () => {
    useApp.getState().addDataset({ id: "a", name: "a", data: { time: [1], values: [[1]], labels: ["m"], units: [""], metadata: {} } });
    const id = useApp.getState().datasets[0].id;
    useApp.setState({ selectedIds: [id], confirmRemove: false });
    expect(isDisabled("edit-delete")).toBe(false);
    get("edit-delete").run();
    expect(useApp.getState().datasets).toHaveLength(0);
  });
});
