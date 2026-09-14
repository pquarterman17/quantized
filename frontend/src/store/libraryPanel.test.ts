// LIBRARY_WORKBOOK_UX_PLAN PR C: the tree renderer's UI state — workbook
// disclosure, folder/workbook selection, and the L0.6 remembered child. This
// file tests the store slice's mutators in isolation; PR E2 (lib/
// workspace.test.ts's "workspace session restoration" describe) covers their
// .dwk persistence. See this slice's module doc and architecture.test.ts's
// HISTORY_EXCLUDED entries for why they're still excluded from undo.

import { beforeEach, describe, expect, it } from "vitest";

import { __resetLastPointerPress } from "../lib/lastPointerPress";
import { useApp } from "./useApp";

describe("libraryPanel slice — PR C additions", () => {
  beforeEach(() => {
    useApp.setState({ expandedWorkbookIds: [], librarySelection: null, workbookLastChild: {} });
  });

  describe("expandedWorkbookIds / toggleWorkbookExpanded", () => {
    it("expands a collapsed workbook", () => {
      useApp.getState().toggleWorkbookExpanded("w1");
      expect(useApp.getState().expandedWorkbookIds).toEqual(["w1"]);
    });

    it("collapses an already-expanded workbook", () => {
      useApp.getState().toggleWorkbookExpanded("w1");
      useApp.getState().toggleWorkbookExpanded("w1");
      expect(useApp.getState().expandedWorkbookIds).toEqual([]);
    });

    it("tracks multiple workbooks independently", () => {
      useApp.getState().toggleWorkbookExpanded("w1");
      useApp.getState().toggleWorkbookExpanded("w2");
      expect(useApp.getState().expandedWorkbookIds.sort()).toEqual(["w1", "w2"]);
    });
  });

  describe("librarySelection / setLibrarySelection", () => {
    it("sets a folder selection", () => {
      useApp.getState().setLibrarySelection({ kind: "folder", id: "f1" });
      expect(useApp.getState().librarySelection).toEqual({ kind: "folder", id: "f1" });
    });

    it("sets a workbook selection, replacing any prior selection", () => {
      useApp.getState().setLibrarySelection({ kind: "folder", id: "f1" });
      useApp.getState().setLibrarySelection({ kind: "workbook", id: "w1" });
      expect(useApp.getState().librarySelection).toEqual({ kind: "workbook", id: "w1" });
    });

    it("clears back to null", () => {
      useApp.getState().setLibrarySelection({ kind: "workbook", id: "w1" });
      useApp.getState().setLibrarySelection(null);
      expect(useApp.getState().librarySelection).toBeNull();
    });

    // P1 fix (delete-shortcut misfire): a folder/workbook selection and a
    // dataset selection must be mutually exclusive, or Delete/Backspace can
    // resolve to the wrong object (LibraryTree.tsx's own Delete handling vs.
    // useGlobalShortcuts.ts's removeSelected() fallback).
    it("selecting a folder/workbook clears any dataset multi-selection", () => {
      useApp.setState({ selectedIds: ["d1", "d2"] });
      useApp.getState().setLibrarySelection({ kind: "workbook", id: "w1" });
      expect(useApp.getState().selectedIds).toEqual([]);
    });

    it("clearing back to null does not itself touch selectedIds", () => {
      useApp.setState({ selectedIds: ["d1"] });
      useApp.getState().setLibrarySelection({ kind: "folder", id: "f1" });
      useApp.getState().setLibrarySelection(null);
      expect(useApp.getState().selectedIds).toEqual([]); // still whatever the folder-select left it at
    });
  });

  describe("workbookLastChild / setWorkbookLastChild", () => {
    it("records the last-opened child key for a workbook", () => {
      useApp.getState().setWorkbookLastChild("w1", "worksheet:d1");
      expect(useApp.getState().workbookLastChild.w1).toBe("worksheet:d1");
    });

    it("overwrites the previous entry for the same workbook", () => {
      useApp.getState().setWorkbookLastChild("w1", "worksheet:d1");
      useApp.getState().setWorkbookLastChild("w1", "editable-figure:fig1");
      expect(useApp.getState().workbookLastChild.w1).toBe("editable-figure:fig1");
    });

    it("tracks multiple workbooks independently", () => {
      useApp.getState().setWorkbookLastChild("w1", "worksheet:d1");
      useApp.getState().setWorkbookLastChild("w2", "worksheet:d3");
      expect(useApp.getState().workbookLastChild).toEqual({ w1: "worksheet:d1", w2: "worksheet:d3" });
    });
  });
});

// ROUND 6 of the Tiles drag/drop review (2026-09-14). The owner press of a
// drag used to be snapshotted by ONE of `activeDrag`'s five publishers, which
// meant four of them recorded none and the one that did could leave a snapshot
// behind for a later, unrelated drag to inherit. It now rides `setActiveDrag`
// itself, so the two fields can only ever move together — these tests are what
// makes that structural, rather than another invariant each publisher has to
// remember. The DOM-level consequences are in
// components/Library/LibraryTiles.parity.test.tsx.
describe("libraryPanel slice — activeDrag carries its own owner press", () => {
  const press = (pointerId: number, pointerType: string): void => {
    document.dispatchEvent(
      new PointerEvent("pointerdown", { pointerId, pointerType, bubbles: true, cancelable: true }),
    );
  };

  beforeEach(() => {
    __resetLastPointerPress();
    useApp.setState({ activeDrag: null, activeDragPress: null });
  });

  it("snapshots the press that was last seen before the drag was published", () => {
    press(9, "pen");
    useApp.getState().setActiveDrag({ kind: "folder", id: "f1" });
    expect(useApp.getState().activeDragPress).toEqual({ id: 9, type: "pen" });
  });

  it("publishes a null press when no press preceded the drag", () => {
    useApp.getState().setActiveDrag({ kind: "folder", id: "f1" });
    expect(useApp.getState().activeDrag).toEqual({ kind: "folder", id: "f1" });
    expect(useApp.getState().activeDragPress).toBeNull();
  });

  it("re-snapshots on every publish, so a replacing drag never inherits the previous drag's press", () => {
    press(9, "pen");
    useApp.getState().setActiveDrag({ kind: "folder", id: "f1" });
    press(1, "mouse");
    useApp.getState().setActiveDrag({ kind: "workbook", id: "w1" });
    expect(useApp.getState().activeDragPress).toEqual({ id: 1, type: "mouse" });
  });

  it("clears the snapshot together with the drag, so none can outlive its drag", () => {
    press(9, "pen");
    useApp.getState().setActiveDrag({ kind: "folder", id: "f1" });
    useApp.getState().setActiveDrag(null);
    expect(useApp.getState().activeDrag).toBeNull();
    expect(useApp.getState().activeDragPress).toBeNull();
  });
});
