// GUI_INTERACTION #8: the generic registry engine — `actionMenuItem` /
// `buildMenuItems` / `runContextAction` / `isContextMenuKeyEvent` — tested
// against a tiny synthetic action type so the mechanics (enabled/hidden
// gating, destructive confirm routing) are isolated from any one real
// registry (dataset/folder/curve each get their own coverage via their
// consuming component's tests — DatasetRow/FolderRow/plotMenu).

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  actionMenuItem,
  buildMenuItems,
  isContextMenuKeyEvent,
  runContextAction,
  type ContextAction,
} from "./contextActions";
import { askConfirm } from "../components/overlays/ConfirmDialog";

vi.mock("../components/overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));

interface Target {
  n: number;
  enabled: boolean;
}

const run = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

describe("actionMenuItem", () => {
  it("resolves a string label as-is and a function label against the target", () => {
    const staticAction: ContextAction<Target> = { id: "a", label: "Static", run };
    const dynamicAction: ContextAction<Target> = { id: "b", label: (t) => `N=${t.n}`, run };
    expect(actionMenuItem(staticAction, { n: 5, enabled: true })).toMatchObject({ label: "Static" });
    expect(actionMenuItem(dynamicAction, { n: 5, enabled: true })).toMatchObject({ label: "N=5" });
  });

  it("enabled predicate gates disabled (item still present)", () => {
    const action: ContextAction<Target> = { id: "a", label: "A", enabled: (t) => t.enabled, run };
    expect(actionMenuItem(action, { n: 0, enabled: true })).toMatchObject({ disabled: false });
    expect(actionMenuItem(action, { n: 0, enabled: false })).toMatchObject({ disabled: true });
  });

  it("no enabled predicate means never disabled", () => {
    const action: ContextAction<Target> = { id: "a", label: "A", run };
    expect(actionMenuItem(action, { n: 0, enabled: false })).toMatchObject({ disabled: false });
  });

  it("hidden predicate omits the item entirely (null, not disabled)", () => {
    const action: ContextAction<Target> = { id: "a", label: "A", hidden: (t) => t.n === 0, run };
    expect(actionMenuItem(action, { n: 0, enabled: true })).toBeNull();
    expect(actionMenuItem(action, { n: 1, enabled: true })).not.toBeNull();
  });

  it("a destructive action carries the danger flag on its item", () => {
    const action: ContextAction<Target> = { id: "a", label: "Remove", destructive: true, run };
    expect(actionMenuItem(action, { n: 0, enabled: true })).toMatchObject({ danger: true });
  });
});

describe("buildMenuItems", () => {
  it("passes separators through untouched and filters hidden actions", () => {
    const actions: ContextAction<Target>[] = [
      { id: "a", label: "A", run },
      { id: "b", label: "B", hidden: () => true, run },
    ];
    const items = buildMenuItems([actions[0], { separator: true }, actions[1]], { n: 0, enabled: true });
    expect(items).toHaveLength(2); // "A" + the separator; "B" is hidden
    expect(items[1]).toEqual({ separator: true });
  });
});

describe("runContextAction", () => {
  it("a non-destructive action runs immediately, no confirm dialog", () => {
    const action: ContextAction<Target> = { id: "a", label: "A", run };
    runContextAction(action, { n: 0, enabled: true });
    expect(run).toHaveBeenCalledOnce();
    expect(askConfirm).not.toHaveBeenCalled();
  });

  it("a destructive action confirms first — declined means run() never fires", async () => {
    vi.mocked(askConfirm).mockResolvedValue(false);
    const action: ContextAction<Target> = {
      id: "a",
      label: "Remove",
      destructive: true,
      confirm: (t) => ({ title: `Remove ${t.n}?`, confirmLabel: "Remove" }),
      run,
    };
    runContextAction(action, { n: 3, enabled: true });
    expect(askConfirm).toHaveBeenCalledWith("Remove 3?", "", "Remove", true);
    await Promise.resolve();
    expect(run).not.toHaveBeenCalled();
  });

  it("a destructive action confirmed runs with the original target", async () => {
    vi.mocked(askConfirm).mockResolvedValue(true);
    const action: ContextAction<Target> = { id: "a", label: "Remove", destructive: true, run };
    const target = { n: 7, enabled: true };
    runContextAction(action, target);
    await Promise.resolve();
    expect(run).toHaveBeenCalledWith(target);
  });

  it("a destructive action with no `confirm` spec falls back to a generic title", async () => {
    vi.mocked(askConfirm).mockResolvedValue(true);
    const action: ContextAction<Target> = { id: "a", label: "Remove", destructive: true, run };
    runContextAction(action, { n: 0, enabled: true });
    expect(askConfirm).toHaveBeenCalledWith("Remove?", "", "Remove", true);
  });
});

describe("isContextMenuKeyEvent", () => {
  it("recognizes the dedicated ContextMenu key", () => {
    expect(isContextMenuKeyEvent({ key: "ContextMenu", shiftKey: false })).toBe(true);
  });
  it("recognizes Shift+F10", () => {
    expect(isContextMenuKeyEvent({ key: "F10", shiftKey: true })).toBe(true);
  });
  it("rejects a plain F10 or an unrelated key", () => {
    expect(isContextMenuKeyEvent({ key: "F10", shiftKey: false })).toBe(false);
    expect(isContextMenuKeyEvent({ key: "Enter", shiftKey: false })).toBe(false);
  });
});

// Finding #10: `hasSavedTemplates` (behind `folder.runTemplate`'s `hidden`
// gate) must read the SAME storage key lib/template.ts actually writes to —
// exercised through the real `saveTemplate`, not a hardcoded duplicate that
// could silently drift from it.
describe("folder.runTemplate (finding #10 — shares lib/template.ts's storage key)", () => {
  const folderTarget = (count: number) => ({
    folder: { id: "f1", name: "Folder", parentId: null, order: 0 },
    count,
    onRename: vi.fn(),
    onExpand: vi.fn(),
  });

  beforeEach(() => {
    localStorage.clear();
  });

  it("is hidden with no saved templates, shown once one is saved under lib/template.ts's own key", async () => {
    const { folderBulkActions } = await import("../components/Library/folderRowMenu");
    const { TEMPLATES_KEY } = await import("./templateKey");
    const { saveTemplate, toTemplate } = await import("./template");
    const { makeStep } = await import("./pipeline");
    const runTemplate = folderBulkActions.find((a) => a.id === "folder.runTemplate")!;

    expect(runTemplate.hidden?.(folderTarget(3))).toBe(true);

    saveTemplate(toTemplate("t", [makeStep("transform", "Stack", "", { op: "stack", channels: [0] })], []));
    expect(localStorage.getItem(TEMPLATES_KEY)).not.toBeNull(); // proves it wrote under the SHARED key
    expect(runTemplate.hidden?.(folderTarget(3))).toBe(false);

    expect(runTemplate.hidden?.(folderTarget(0))).toBe(true); // still hidden for an empty folder
  });
});
