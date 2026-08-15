// LIBRARY_WORKBOOK_UX_PLAN PR C: keyboard traversal, focus-survives-removal,
// and Origin multi-sheet ordering over the flattened hierarchy. Mouse vs
// disclosure separation and the remembered-child open live in
// WorkbookRow.test.tsx; this file covers the container-level roving focus
// and the render dispatch across kinds.
//
// LibraryTree takes `rows` as a prop (computed once by Library.tsx via
// useLibraryHierarchyRows) rather than owning the hook itself — this harness
// mirrors that exact wiring so the test exercises the real reactive path
// (expansion toggles re-flattening the hierarchy) instead of a frozen array.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LibraryTree from "./LibraryTree";
import { useLibraryHierarchyRows } from "./useLibraryHierarchyRows";
import { createFigureDocument } from "../../lib/figureDocument";
import type { OriginFigureEntry } from "../../lib/originFigures";
import { defaultPlotView } from "../../lib/plotview";
import type { Dataset, FolderNode } from "../../lib/types";
import type { WorkbookNode } from "../../lib/workbooks";
import { askConfirm } from "../overlays/ConfirmDialog";
import { useApp } from "../../store/useApp";
import { useGlobalShortcuts } from "../../useGlobalShortcuts";

// P1 fix — Delete/Backspace routing: workbookDeleteActions[0]/folderDeleteActions[0]
// are destructive registry entries, confirmed via the shared ConfirmDialog —
// stub it like every other askConfirm-gated test does (see FolderRow.test.tsx).
vi.mock("../overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));

const fld = (id: string, parentId: string | null = null): FolderNode => ({ id, name: id, parentId, order: 0 });
const wb = (id: string, folderId?: string): WorkbookNode => ({ id, name: id, folderId });
const ds = (id: string, workbookId?: string, originBook?: string, order?: number): Dataset => ({
  id,
  name: `${id}.dat`,
  data: {
    time: [0, 1],
    values: [[1], [2]],
    labels: ["M"],
    units: [""],
    metadata: originBook ? { origin_book: originBook } : {},
  },
  ...(workbookId ? { workbookId } : {}),
  ...(order !== undefined ? { order } : {}),
});

const noop = () => {};

function Harness() {
  const rows = useLibraryHierarchyRows();
  return <LibraryTree rows={rows} onFilterTag={noop} />;
}

const folderRow = (id: string): HTMLElement => document.querySelector(`[data-lib-row="folder:${id}"]`) as HTMLElement;
const workbookRow = (id: string): HTMLElement => document.querySelector(`[data-lib-row="workbook:${id}"]`) as HTMLElement;
const worksheetRow = (id: string): HTMLElement => document.querySelector(`[data-ds-id="${id}"]`) as HTMLElement;

beforeEach(() => {
  useApp.setState({
    folders: [],
    workbooks: [],
    datasets: [],
    originFigures: [],
    editableFigures: [],
    figureDocs: [],
    pages: [],
    reports: [],
    expandedFolders: [],
    expandedWorkbookIds: [],
    librarySelection: null,
    workbookLastChild: {},
    activeId: null,
    selectedIds: [],
  });
});

describe("LibraryTree — keyboard traversal (Up/Down/Left/Right/Enter)", () => {
  beforeEach(() => {
    useApp.setState({
      folders: [fld("f1")],
      workbooks: [wb("w1", "f1")],
      datasets: [ds("d1", "w1"), ds("d2", "w1")],
      expandedFolders: ["f1"],
      expandedWorkbookIds: [],
    });
  });

  it("Down moves folder -> workbook; Right expands the collapsed workbook in place (no focus move); a second Right moves into its first child", () => {
    render(<Harness />);
    folderRow("f1").focus();
    fireEvent.keyDown(folderRow("f1"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(workbookRow("w1"));

    fireEvent.keyDown(workbookRow("w1"), { key: "ArrowRight" });
    expect(useApp.getState().expandedWorkbookIds).toContain("w1");
    expect(document.activeElement).toBe(workbookRow("w1")); // no focus move yet

    fireEvent.keyDown(workbookRow("w1"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(worksheetRow("d1")); // first child, source order
  });

  it("Down/Up traverse sibling worksheets once the workbook is expanded", () => {
    useApp.setState({ expandedWorkbookIds: ["w1"] });
    render(<Harness />);
    worksheetRow("d1").focus();
    fireEvent.keyDown(worksheetRow("d1"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(worksheetRow("d2"));
    fireEvent.keyDown(worksheetRow("d2"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(worksheetRow("d1"));
  });

  it("Left on a leaf worksheet moves to its parent workbook", () => {
    useApp.setState({ expandedWorkbookIds: ["w1"] });
    render(<Harness />);
    worksheetRow("d1").focus();
    fireEvent.keyDown(worksheetRow("d1"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(workbookRow("w1"));
  });

  it("Left on an expanded workbook collapses it in place (no focus move)", () => {
    useApp.setState({ expandedWorkbookIds: ["w1"] });
    render(<Harness />);
    workbookRow("w1").focus();
    fireEvent.keyDown(workbookRow("w1"), { key: "ArrowLeft" });
    expect(useApp.getState().expandedWorkbookIds).not.toContain("w1");
    expect(document.activeElement).toBe(workbookRow("w1"));
  });

  it("Enter on a workbook opens its remembered/first child (same as double-click)", () => {
    render(<Harness />);
    workbookRow("w1").focus();
    fireEvent.keyDown(workbookRow("w1"), { key: "Enter" });
    expect(useApp.getState().activeId).toBe("d1");
  });

  it("Enter on a worksheet activates it, mirroring a click", () => {
    useApp.setState({ expandedWorkbookIds: ["w1"] });
    render(<Harness />);
    worksheetRow("d2").focus();
    fireEvent.keyDown(worksheetRow("d2"), { key: "Enter" });
    expect(useApp.getState().activeId).toBe("d2");
  });

  it("Down/Up are no-ops at either end of the flattened list", () => {
    render(<Harness />);
    folderRow("f1").focus();
    fireEvent.keyDown(folderRow("f1"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(folderRow("f1"));
  });

  it("Escape blurs the focused row", () => {
    render(<Harness />);
    folderRow("f1").focus();
    expect(document.activeElement).toBe(folderRow("f1"));
    fireEvent.keyDown(folderRow("f1"), { key: "Escape" });
    expect(document.activeElement).not.toBe(folderRow("f1"));
  });
});

describe("LibraryTree — focus survives removal of the focused row", () => {
  it("falls back to the nearest surviving row by previous position", () => {
    useApp.setState({ datasets: [ds("d1"), ds("d2"), ds("d3")] });
    render(<Harness />);
    worksheetRow("d2").focus();
    expect(document.activeElement).toBe(worksheetRow("d2"));
    act(() => {
      useApp.getState().removeDataset("d2");
    });
    expect(document.activeElement).toBe(worksheetRow("d3")); // took d2's old index
  });

  it("never steals focus that moved elsewhere for an unrelated reason", () => {
    useApp.setState({ datasets: [ds("d1"), ds("d2")] });
    render(
      <>
        <input aria-label="elsewhere" />
        <Harness />
      </>,
    );
    worksheetRow("d1").focus();
    screen.getByLabelText("elsewhere").focus();
    act(() => {
      useApp.getState().removeDataset("d1");
    });
    expect(document.activeElement).toBe(screen.getByLabelText("elsewhere"));
  });
});

describe("LibraryTree — Origin multi-sheet ordering (L0.16)", () => {
  // lib/libraryHierarchy.ts (PR B) orders worksheet children by the generic
  // `Dataset.order` field via lib/order.ts's byOrder — it has no Origin-
  // specific sheet-number comparator of its own (confirmed against
  // libraryHierarchy.test.ts's own ordering fixtures). This proves the tree
  // renders whatever order that field encodes; datasets carry `.order` set
  // to their sheet position, matching what a sheet-sorted membership (PR
  // A1's deriveWorkbooks already sorts `sortedMembers` by origin sheet
  // number) is expected to stamp.
  it("renders sheets in sheet-number order regardless of input/insertion order", () => {
    // Deliberately scrambled INSERTION order but correctly-keyed `.order` —
    // proves the tree sorts by the order field rather than reflecting
    // insertion position by accident.
    useApp.setState({
      workbooks: [{ id: "w1", name: "Book1", originBook: "Book1" }],
      datasets: [
        ds("sheet3", "w1", "Book1@3", 2),
        ds("sheet1", "w1", "Book1", 0),
        ds("sheet2", "w1", "Book1@2", 1),
      ],
      expandedWorkbookIds: ["w1"],
    });
    render(<Harness />);
    const names = Array.from(document.querySelectorAll(".qzk-ds-name")).map((el) => el.textContent);
    expect(names).toEqual(["sheet1.dat", "sheet2.dat", "sheet3.dat"]);
  });
});

describe("LibraryTree — kind dispatch", () => {
  it("renders a workbook's non-worksheet children (editable figure) once expanded", () => {
    useApp.setState({
      workbooks: [wb("w1")],
      datasets: [ds("d1", "w1")],
      expandedWorkbookIds: ["w1"],
      editableFigures: [createFigureDocument({ id: "fig1", name: "My Figure", datasetId: "d1", view: defaultPlotView() })],
    });
    render(<Harness />);
    expect(screen.getByText(/My Figure/)).toBeInTheDocument();
  });
});

describe("LibraryTree — Delete/Backspace routes to the focused row's OWN delete flow (P1 fix)", () => {
  // The reviewer's exact scenario: an unrelated worksheet is active/selected
  // (so useGlobalShortcuts.ts's removeSelected() fallback WOULD act on it),
  // then the user clicks (focuses + selects) a workbook/folder row and hits
  // Delete. Before the fix, LibraryTree never handled Delete at all, so the
  // keystroke bubbled to the window-level handler and removed "solo".
  beforeEach(() => {
    useApp.setState({
      folders: [fld("f1")],
      workbooks: [wb("w1", "f1")],
      datasets: [ds("d1", "w1"), ds("solo")],
      expandedFolders: ["f1"],
      expandedWorkbookIds: [],
      librarySelection: null,
      activeId: "solo",
      selectedIds: ["solo"],
    });
    vi.mocked(askConfirm).mockReset().mockResolvedValue(true);
  });

  it("Delete on a selected workbook row runs the workbook's own confirm flow — the unrelated worksheet survives", async () => {
    render(<Harness />);
    fireEvent.click(workbookRow("w1")); // WorkbookRow.select: librarySelection = {kind:"workbook", id:"w1"}
    fireEvent.keyDown(workbookRow("w1"), { key: "Delete" });
    expect(askConfirm).toHaveBeenCalledOnce();
    await act(() => Promise.resolve());
    expect(useApp.getState().workbooks.find((w) => w.id === "w1")).toBeUndefined();
    expect(useApp.getState().datasets.some((d) => d.id === "solo")).toBe(true); // survives
  });

  it("Backspace on a selected folder row runs the folder's own (reparent) confirm flow", async () => {
    render(<Harness />);
    fireEvent.click(folderRow("f1")); // FolderRow's onClick: librarySelection = {kind:"folder", id:"f1"}
    fireEvent.keyDown(folderRow("f1"), { key: "Backspace" });
    expect(askConfirm).toHaveBeenCalledOnce();
    await act(() => Promise.resolve());
    expect(useApp.getState().folders.find((f) => f.id === "f1")).toBeUndefined();
    expect(useApp.getState().datasets.some((d) => d.id === "solo")).toBe(true); // survives
  });

  it("Delete on a focused worksheet row still falls through to the global dataset handler (unchanged)", () => {
    useApp.setState({ expandedWorkbookIds: ["w1"] });
    render(<Harness />);
    worksheetRow("d1").focus();
    fireEvent.keyDown(worksheetRow("d1"), { key: "Delete" });
    expect(askConfirm).not.toHaveBeenCalled(); // LibraryTree didn't intercept it
  });
});

describe("LibraryTree — keyboard hijack guard: nested controls own their own keys (P2 fix)", () => {
  beforeEach(() => {
    useApp.setState({
      folders: [],
      workbooks: [wb("w1")],
      datasets: [ds("d1", "w1")],
      expandedWorkbookIds: [],
      librarySelection: null,
      workbookLastChild: {},
      activeId: null,
    });
  });

  const openRename = (): HTMLInputElement => {
    fireEvent.contextMenu(workbookRow("w1"));
    fireEvent.click(screen.getByText("Rename…"));
    return document.querySelector(".qzk-folder-rename") as HTMLInputElement;
  };

  it("Enter inside a rename input commits the rename WITHOUT also opening the row", () => {
    render(<Harness />);
    const input = openRename();
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useApp.getState().workbooks.find((w) => w.id === "w1")!.name).toBe("Renamed");
    expect(useApp.getState().activeId).toBeNull(); // NOT also opened/activated
  });

  it("ArrowDown inside a rename input does not move roving tree focus", () => {
    render(<Harness />);
    const input = openRename();
    input.focus();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(document.activeElement).toBe(input); // focus stayed in the input
  });

  it("Escape inside a rename input cancels the rename WITHOUT the container also blurring it via a second handler", () => {
    render(<Harness />);
    const input = openRename();
    fireEvent.keyDown(input, { key: "Escape" });
    // The rename input's own handler ran (setRename(null) unmounts it);
    // nothing here asserts document.activeElement, since the input itself
    // is gone — the point is the workbook's name is untouched.
    expect(useApp.getState().workbooks.find((w) => w.id === "w1")!.name).toBe("w1");
  });

  it("Enter on the row anchor itself still opens (unaffected by the guard)", () => {
    render(<Harness />);
    workbookRow("w1").focus();
    fireEvent.keyDown(workbookRow("w1"), { key: "Enter" });
    expect(useApp.getState().activeId).toBe("d1");
  });
});

describe("LibraryTree — button row anchors (ArtifactRow/FigureRow) are the container's keys, not the global handler's (P1 fix)", () => {
  // Reviewer's scenario, with the REAL global shortcut hook mounted: the
  // ArtifactRow/FigureRow anchor is itself a <button data-lib-row>, so an
  // element-kind editor test misclassified it as a nested control and the
  // container ignored its keystrokes — arrows then reached the global
  // prev/next-dataset navigation and Delete/Backspace reached
  // removeSelected(), acting on an UNRELATED active dataset.
  const originEntry: OriginFigureEntry = {
    id: "g1",
    stem: "Moke",
    datasetId: "d1",
    siblingIds: ["d1"],
    figure: { name: "MokeGraph", x_from: 0, x_to: 1, x_log: false, y_from: 0, y_to: 1, y_log: false, n_curves: 1, annotations: [] },
  };

  function GlobalHarness() {
    useGlobalShortcuts();
    const rows = useLibraryHierarchyRows();
    return <LibraryTree rows={rows} onFilterTag={noop} />;
  }

  const artifactRow = (): HTMLElement => document.querySelector('[data-lib-row="editable-figure:fig1"]') as HTMLElement;
  const figureRow = (): HTMLElement => document.querySelector('[data-lib-row="origin-figure:g1"]') as HTMLElement;

  beforeEach(() => {
    useApp.setState({
      folders: [],
      workbooks: [wb("w1")],
      datasets: [ds("d1", "w1"), ds("solo")],
      originFigures: [originEntry],
      editableFigures: [createFigureDocument({ id: "fig1", name: "My Figure", datasetId: "d1", view: defaultPlotView() })],
      expandedWorkbookIds: ["w1"],
      librarySelection: null,
      activeId: "solo",
      selectedIds: ["solo"],
      confirmRemove: false, // Delete would remove immediately if it fell through
    });
    vi.mocked(askConfirm).mockReset().mockResolvedValue(true);
  });

  it.each([
    ["ArtifactRow", artifactRow],
    ["Origin FigureRow", figureRow],
  ])("arrows on a focused %s move roving tree focus without changing the active dataset", (_kind, row) => {
    render(<GlobalHarness />);
    row().focus();
    fireEvent.keyDown(row(), { key: "ArrowUp" });
    expect(useApp.getState().activeId).toBe("solo"); // global dataset nav did NOT step
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
    expect(useApp.getState().activeId).toBe("solo");
    expect(document.activeElement?.hasAttribute("data-lib-row") || document.activeElement?.hasAttribute("data-ds-id")).toBe(true);
  });

  it.each([
    ["ArtifactRow", "Delete", artifactRow],
    ["ArtifactRow", "Backspace", artifactRow],
    ["Origin FigureRow", "Delete", figureRow],
    ["Origin FigureRow", "Backspace", figureRow],
  ])("%s consumes %s — the active/selected dataset survives", (_kind, key, row) => {
    render(<GlobalHarness />);
    row().focus();
    fireEvent.keyDown(row(), { key });
    expect(useApp.getState().datasets.some((d) => d.id === "solo")).toBe(true);
    expect(useApp.getState().datasets).toHaveLength(2); // nothing was removed
  });

  it("arrows on a focused WORKSHEET row also stay roving-focus only (defaultPrevented now gates the global nav)", () => {
    render(<GlobalHarness />);
    worksheetRow("d1").focus();
    fireEvent.keyDown(worksheetRow("d1"), { key: "ArrowDown" });
    expect(useApp.getState().activeId).toBe("solo"); // unchanged: one keystroke, one handler
  });
});

describe("LibraryTree — L0.25 select/open/disclosure contract, every node kind (PR #139 review)", () => {
  // Table-driven per the review: single-click changes SELECTION but never the
  // active content; double-click (and Enter, covered per-kind below) opens;
  // the caret toggles without selecting or opening; right-click selects; and
  // switching among rows leaves exactly ONE coherent current item.
  const originEntry: OriginFigureEntry = {
    id: "g1",
    stem: "Moke",
    datasetId: "d1",
    siblingIds: ["d1"],
    figure: { name: "MokeGraph", x_from: 0, x_to: 1, x_log: false, y_from: 0, y_to: 1, y_log: false, n_curves: 1, annotations: [] },
  };

  beforeEach(() => {
    useApp.setState({
      folders: [fld("f1")],
      workbooks: [wb("w1", "f1")],
      datasets: [ds("d1", "w1"), ds("solo")],
      originFigures: [originEntry],
      editableFigures: [createFigureDocument({ id: "fig1", name: "My Figure", datasetId: "d1", view: defaultPlotView() })],
      figureDocs: [],
      pages: [],
      reports: [{ id: "rep1", name: "My Report", datasetId: "d1", report: { title: "R", sections: [] } }],
      expandedFolders: ["f1"],
      expandedWorkbookIds: ["w1"],
      librarySelection: null,
      workbookLastChild: {},
      activeId: "solo",
      selectedIds: ["solo"],
      openReportId: null,
    });
  });

  const row = (key: string): HTMLElement => document.querySelector(`[data-lib-row="${key}"]`) as HTMLElement;

  // [kind, key, expected librarySelection after a single click]
  const librarySelectionKinds: Array<[string, string, { kind: string; id: string }]> = [
    ["folder", "folder:f1", { kind: "folder", id: "f1" }],
    ["workbook", "workbook:w1", { kind: "workbook", id: "w1" }],
    ["origin-figure", "origin-figure:g1", { kind: "origin-figure", id: "g1" }],
    ["editable-figure", "editable-figure:fig1", { kind: "editable-figure", id: "fig1" }],
    ["report", "report:rep1", { kind: "report", id: "rep1" }],
  ];

  it.each(librarySelectionKinds)("%s: single click selects (one coherent current item) and never touches the active plot", (_kind, key, expected) => {
    render(<Harness />);
    fireEvent.click(row(key));
    const s = useApp.getState();
    expect(s.librarySelection).toEqual(expected);
    expect(s.selectedIds).toEqual([]); // librarySelection displaced the dataset selection
    expect(s.activeId).toBe("solo"); // active content untouched
  });

  it.each(librarySelectionKinds)("%s: right-click selects before its menu", (_kind, key, expected) => {
    render(<Harness />);
    fireEvent.contextMenu(row(key));
    expect(useApp.getState().librarySelection).toEqual(expected);
    expect(useApp.getState().activeId).toBe("solo");
  });

  it("worksheet: single click selects (selectedIds — the dataset selection IS its selection) without re-plotting", () => {
    render(<Harness />);
    fireEvent.click(worksheetRow("d1"));
    const s = useApp.getState();
    expect(s.selectedIds).toEqual(["d1"]);
    expect(s.librarySelection).toBeNull(); // displaced the other direction
    expect(s.activeId).toBe("solo"); // click did NOT open/plot
  });

  it("worksheet: double-click opens (activates) and records the remembered child", () => {
    render(<Harness />);
    fireEvent.doubleClick(worksheetRow("d1"));
    expect(useApp.getState().activeId).toBe("d1");
    expect(useApp.getState().workbookLastChild.w1).toBe("worksheet:d1");
  });

  it("worksheet: Enter opens via the container", () => {
    render(<Harness />);
    worksheetRow("d1").focus();
    fireEvent.keyDown(worksheetRow("d1"), { key: "Enter" });
    expect(useApp.getState().activeId).toBe("d1");
  });

  it("editable-figure: double-click opens exactly once and records the remembered child", () => {
    render(<Harness />);
    fireEvent.doubleClick(row("editable-figure:fig1"));
    expect(useApp.getState().workbookLastChild.w1).toBe("editable-figure:fig1");
  });

  it("report: Enter opens via the container (setOpenReport)", () => {
    render(<Harness />);
    row("report:rep1").focus();
    fireEvent.keyDown(row("report:rep1"), { key: "Enter" });
    expect(useApp.getState().openReportId).toBe("rep1");
  });

  it("folder: the caret toggles disclosure WITHOUT selecting; a body double-click is the folder's open (toggle)", () => {
    render(<Harness />);
    const caret = row("folder:f1").querySelector(".qzk-group-caret") as HTMLElement;
    fireEvent.click(caret);
    expect(useApp.getState().expandedFolders).not.toContain("f1"); // collapsed
    expect(useApp.getState().librarySelection).toBeNull(); // caret never selects
    fireEvent.click(caret);
    expect(useApp.getState().expandedFolders).toContain("f1");
    fireEvent.doubleClick(row("folder:f1"));
    expect(useApp.getState().expandedFolders).not.toContain("f1"); // body dbl-click = open = toggle
  });

  it("switching folder -> workbook -> worksheet rows leaves exactly one coherent current item at each step", () => {
    render(<Harness />);
    fireEvent.click(row("folder:f1"));
    expect(useApp.getState().librarySelection).toEqual({ kind: "folder", id: "f1" });
    fireEvent.click(row("workbook:w1"));
    expect(useApp.getState().librarySelection).toEqual({ kind: "workbook", id: "w1" });
    expect(useApp.getState().selectedIds).toEqual([]);
    fireEvent.click(worksheetRow("d1"));
    expect(useApp.getState().librarySelection).toBeNull();
    expect(useApp.getState().selectedIds).toEqual(["d1"]);
    fireEvent.click(row("origin-figure:g1"));
    expect(useApp.getState().librarySelection).toEqual({ kind: "origin-figure", id: "g1" });
    expect(useApp.getState().selectedIds).toEqual([]);
  });

  it("Ctrl/Cmd and Shift dataset multi-selection keep their meaning in the tree and displace librarySelection", () => {
    useApp.setState({ expandedWorkbookIds: ["w1"], librarySelection: { kind: "workbook", id: "w1" } });
    render(<Harness />);
    fireEvent.click(worksheetRow("d1"), { ctrlKey: true }); // toggle into the multi-selection
    const s = useApp.getState();
    expect(s.selectedIds).toContain("d1");
    expect(s.librarySelection).toBeNull(); // store chokepoint keeps ONE current item
  });
});
