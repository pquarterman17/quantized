import { describe, expect, it, vi } from "vitest";

import type { PageSlot, PanelSourceStatus } from "../../../lib/figurepage";
import { buildPanelMenuItems, primaryPanelAction } from "./panelMenu";

function actions() {
  return {
    onEdit: vi.fn(),
    onSaveAsFigure: vi.fn(),
    onPromote: vi.fn(),
    onDuplicateForPage: vi.fn(),
    onClear: vi.fn(),
  };
}

const EMPTY: PageSlot = { source: null, label: null, title: null };
const FIGURE: PageSlot = { source: { kind: "figure", id: "f1", name: "Loop" }, label: null, title: null };
const WINDOW: PageSlot = { source: { kind: "window", id: "w1", name: "Loop A" }, label: null, title: null };
const FIGDOC: PageSlot = { source: { kind: "figdoc", id: "d1", name: "Old figure" }, label: null, title: null };

const OK_LIVE: PanelSourceStatus = { status: "ok", lifecycle: "live" };
const OK_FROZEN: PanelSourceStatus = { status: "ok", lifecycle: "frozen" };
const MISSING: PanelSourceStatus = { status: "missing" };
const EMPTY_STATUS: PanelSourceStatus = { status: "empty" };

function runItem(items: ReturnType<typeof buildPanelMenuItems>, label: string): void {
  const item = items.find((it) => "label" in it && it.label === label);
  if (!item || !("run" in item)) throw new Error(`menu item "${label}" not found or not runnable`);
  item.run();
}

describe("panelMenu (F3.4 unify panel editing)", () => {
  describe("primaryPanelAction", () => {
    it("is null for an empty slot", () => {
      expect(primaryPanelAction(EMPTY, EMPTY_STATUS, actions())).toBeNull();
    });

    it("is null for a missing source — never invents an edit target", () => {
      expect(primaryPanelAction(FIGURE, MISSING, actions())).toBeNull();
    });

    it("is onEdit for a figure-kind slot", () => {
      const a = actions();
      primaryPanelAction(FIGURE, OK_LIVE, a)?.();
      expect(a.onEdit).toHaveBeenCalledOnce();
    });

    it("is onEdit for a window-kind slot", () => {
      const a = actions();
      primaryPanelAction(WINDOW, OK_LIVE, a)?.();
      expect(a.onEdit).toHaveBeenCalledOnce();
    });

    it("is onPromote for a figdoc-kind slot", () => {
      const a = actions();
      primaryPanelAction(FIGDOC, OK_FROZEN, a)?.();
      expect(a.onPromote).toHaveBeenCalledOnce();
    });
  });

  describe("buildPanelMenuItems", () => {
    it("is empty for an unassigned slot — nothing to act on yet", () => {
      expect(buildPanelMenuItems(EMPTY, EMPTY_STATUS, actions())).toEqual([]);
    });

    it("offers ONLY Clear for a missing source — never a dead end, never an edit/promote/duplicate offer", () => {
      const items = buildPanelMenuItems(FIGURE, MISSING, actions());
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ label: "Clear panel", danger: true });
    });

    it("a figure-kind slot offers Edit figure, Duplicate for this page, and Clear", () => {
      const a = actions();
      const items = buildPanelMenuItems(FIGURE, OK_LIVE, a);
      const labels = items.filter((it) => "label" in it).map((it) => (it as { label: string }).label);
      expect(labels).toEqual(["Edit figure", "Duplicate for this page", "Clear panel"]);
      runItem(items, "Edit figure");
      expect(a.onEdit).toHaveBeenCalledOnce();
      runItem(items, "Duplicate for this page");
      expect(a.onDuplicateForPage).toHaveBeenCalledOnce();
    });

    it("a window-kind slot offers Focus window, Save as editable figure, and Clear", () => {
      const a = actions();
      const items = buildPanelMenuItems(WINDOW, OK_LIVE, a);
      const labels = items.filter((it) => "label" in it).map((it) => (it as { label: string }).label);
      expect(labels).toEqual(["Focus window", "Save as editable figure", "Clear panel"]);
      runItem(items, "Focus window");
      expect(a.onEdit).toHaveBeenCalledOnce();
      runItem(items, "Save as editable figure");
      expect(a.onSaveAsFigure).toHaveBeenCalledOnce();
    });

    it("a figdoc-kind slot offers ONLY Create editable copy and Clear (no direct edit)", () => {
      const a = actions();
      const items = buildPanelMenuItems(FIGDOC, OK_FROZEN, a);
      const labels = items.filter((it) => "label" in it).map((it) => (it as { label: string }).label);
      expect(labels).toEqual(["Create editable copy", "Clear panel"]);
      runItem(items, "Create editable copy");
      expect(a.onPromote).toHaveBeenCalledOnce();
    });

    it("Clear always runs onClear regardless of kind", () => {
      const a = actions();
      runItem(buildPanelMenuItems(WINDOW, OK_LIVE, a), "Clear panel");
      expect(a.onClear).toHaveBeenCalledOnce();
    });
  });
});
