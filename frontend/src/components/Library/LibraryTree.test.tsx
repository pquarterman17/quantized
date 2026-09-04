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
import { askParams } from "../overlays/ParamDialog";
import { useApp } from "../../store/useApp";
import type { DatasetTrashEntry } from "../../store/trash";
import { useGlobalShortcuts } from "../../useGlobalShortcuts";

// P1 fix — Delete/Backspace routing: workbookDeleteActions[0]/folderDeleteActions[0]
// are destructive registry entries, confirmed via the shared ConfirmDialog —
// stub it like every other askConfirm-gated test does (see FolderRow.test.tsx).
vi.mock("../overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));
// Round 3: lib/datasetRemoval.ts honors Preferences ▸ "Confirm before
// removing data" through ParamDialog's askParams — stubbed for the
// cancelled-confirmation regression.
vi.mock("../overlays/ParamDialog", () => ({ askParams: vi.fn() }));

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
    fireEvent.keyDown(folderRow("f1"), { key: "ArrowUp" }); // clamp at the FIRST row
    expect(document.activeElement).toBe(folderRow("f1"));
    // Retrospective-audit fix: the name promised BOTH ends but only the top
    // was asserted — also clamp ArrowDown at the LAST row.
    workbookRow("w1").focus();
    fireEvent.keyDown(workbookRow("w1"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(workbookRow("w1"));
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
      trash: [],
      history: [],
      confirmRemove: false,
    });
    vi.mocked(askConfirm).mockReset().mockResolvedValue(true);
  });

  it("Delete on a selected workbook row runs the workbook's own delete flow, gated by confirm (PR M lift)", async () => {
    render(<Harness />);
    fireEvent.click(workbookRow("w1")); // WorkbookRow.select: librarySelection = {kind:"workbook", id:"w1"}
    fireEvent.keyDown(workbookRow("w1"), { key: "Delete" });
    expect(askConfirm).toHaveBeenCalledOnce(); // PR M: workbookDeleteBlockers is lifted, confirm gates instead
    await act(() => Promise.resolve());
    const s = useApp.getState();
    expect(s.workbooks.some((w) => w.id === "w1")).toBe(false); // workbook deleted
    expect(s.datasets.some((d) => d.id === "d1")).toBe(false); // member sent to trash
    expect((s.trash as DatasetTrashEntry[]).map((t) => t.dataset.id)).toEqual(["d1"]);
    expect(s.datasets.some((d) => d.id === "solo")).toBe(true); // the unrelated selected/active dataset untouched
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

  it("Delete on a focused worksheet row removes exactly THAT row (round 3: focused-row targeting, not the global selection)", () => {
    useApp.setState({ expandedWorkbookIds: ["w1"], confirmRemove: false });
    render(<Harness />);
    worksheetRow("d1").focus();
    fireEvent.keyDown(worksheetRow("d1"), { key: "Delete" });
    const s = useApp.getState();
    expect(s.datasets.some((d) => d.id === "d1")).toBe(false); // the focused row went
    expect(s.datasets.some((d) => d.id === "solo")).toBe(true); // the selected/active one did NOT
    expect((s.trash as DatasetTrashEntry[]).map((t) => t.dataset.id)).toEqual(["d1"]);
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
      trash: [],
      history: [],
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

  it("Delete/arrows on nested NON-editor controls (drag handle, menu button, figure buttons) are consumed — never the global handler's (retrospective-audit P1)", () => {
    render(<GlobalHarness />);
    const before = useApp.getState().datasets.length;
    const controls = [
      workbookRow("w1").querySelector(".qzk-drag-handle") as HTMLElement,
      workbookRow("w1").querySelector(".qzk-menu-btn") as HTMLElement,
      figureRow().parentElement?.querySelector(".qz-icon-btn") as HTMLElement, // FigureRow's ⊞
    ];
    for (const el of controls) {
      el.focus();
      fireEvent.keyDown(el, { key: "Delete" });
      fireEvent.keyDown(el, { key: "ArrowDown" });
    }
    const s = useApp.getState();
    expect(s.datasets).toHaveLength(before); // nothing deleted
    expect(s.activeId).toBe("solo"); // nothing stepped
    expect(s.trash ?? []).toHaveLength(0);
  });

  it("arrows INSIDE a rename input still move the text cursor natively (text-editor exemption survives)", () => {
    render(<GlobalHarness />);
    fireEvent.contextMenu(workbookRow("w1"));
    fireEvent.click(screen.getByText("Rename…"));
    const input = document.querySelector(".qzk-folder-rename") as HTMLInputElement;
    input.focus();
    const evt = fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(evt).toBe(true); // not preventDefault'd by the container — native editing keeps it
    expect(document.activeElement).toBe(input);
  });
});

describe("LibraryTree — focused-worksheet Delete targets the FOCUSED row (round-3 P1 fix, real global hook mounted)", () => {
  // Roving arrows move DOM focus WITHOUT changing selectedIds/librarySelection,
  // so deferring worksheet Delete to the global selection-based handler could
  // remove a different dataset entirely (the stale selection, or the active
  // plot as its fallback). The tree now consumes the key and routes an
  // explicit id list through the shared lib/datasetRemoval.ts helper.
  function GlobalHarness() {
    useGlobalShortcuts();
    const rows = useLibraryHierarchyRows();
    return <LibraryTree rows={rows} onFilterTag={noop} />;
  }

  beforeEach(() => {
    useApp.setState({
      folders: [],
      workbooks: [wb("w1")],
      datasets: [ds("d1", "w1"), ds("d2", "w1"), ds("solo")],
      originFigures: [],
      editableFigures: [createFigureDocument({ id: "fig1", name: "My Figure", datasetId: "d1", view: defaultPlotView() })],
      expandedWorkbookIds: ["w1"],
      librarySelection: null,
      workbookLastChild: {},
      activeId: "solo",
      selectedIds: [],
      trash: [],
      history: [],
      confirmRemove: false,
    });
    vi.mocked(askParams).mockReset();
  });

  it("reviewer scenario 1: artifact selected (selection empty) + active solo + focus d1 + Delete removes ONLY d1", () => {
    render(<GlobalHarness />);
    fireEvent.click(document.querySelector('[data-lib-row="editable-figure:fig1"]') as HTMLElement); // clears selectedIds
    expect(useApp.getState().selectedIds).toEqual([]);
    worksheetRow("d1").focus();
    fireEvent.keyDown(worksheetRow("d1"), { key: "Delete" });
    const s = useApp.getState();
    expect(s.datasets.map((d) => d.id).sort()).toEqual(["d2", "solo"]); // solo (the activeId fallback victim) survives
    expect((s.trash as DatasetTrashEntry[]).map((t) => t.dataset.id)).toEqual(["d1"]);
  });

  it("reviewer scenario 2: worksheet A selected, focus B, Delete removes B — not A", () => {
    render(<GlobalHarness />);
    fireEvent.click(worksheetRow("d1")); // selects A (d1)
    worksheetRow("d2").focus();
    fireEvent.keyDown(worksheetRow("d2"), { key: "Backspace" });
    const s = useApp.getState();
    expect(s.datasets.some((d) => d.id === "d1")).toBe(true); // A survives
    expect(s.datasets.some((d) => d.id === "d2")).toBe(false); // B went
    expect((s.trash as DatasetTrashEntry[]).map((t) => t.dataset.id)).toEqual(["d2"]);
  });

  it("a focused worksheet inside a Ctrl/Cmd multi-selection deletes the whole selection together", () => {
    render(<GlobalHarness />);
    fireEvent.click(worksheetRow("d1"));
    fireEvent.click(worksheetRow("d2"), { ctrlKey: true }); // selection = [d1, d2]
    expect(useApp.getState().selectedIds.sort()).toEqual(["d1", "d2"]);
    worksheetRow("d2").focus();
    fireEvent.keyDown(worksheetRow("d2"), { key: "Delete" });
    const s = useApp.getState();
    expect(s.datasets.map((d) => d.id)).toEqual(["solo"]);
    expect((s.trash as DatasetTrashEntry[]).map((t) => t.dataset.id).sort()).toEqual(["d1", "d2"]);
    expect(s.history).toHaveLength(1); // one batch, one Undo
  });

  it("a cancelled confirmation changes nothing — datasets, Trash, history, selection", async () => {
    useApp.setState({ confirmRemove: true });
    vi.mocked(askParams).mockResolvedValue(false as never); // cancel
    render(<GlobalHarness />);
    fireEvent.click(worksheetRow("d1"));
    worksheetRow("d1").focus();
    fireEvent.keyDown(worksheetRow("d1"), { key: "Delete" });
    expect(askParams).toHaveBeenCalledOnce();
    await act(() => Promise.resolve());
    const s = useApp.getState();
    expect(s.datasets).toHaveLength(3);
    expect(s.trash).toHaveLength(0);
    expect(s.history).toHaveLength(0);
    expect(s.selectedIds).toEqual(["d1"]);
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

  it("artifact rows share the lifecycle menu by pointer and keyboard", () => {
    render(<Harness />);
    const report = row("report:rep1");
    fireEvent.contextMenu(report, { clientX: 12, clientY: 18 });
    expect(screen.getByRole("menuitem", { name: "Open" })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "Duplicate" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Duplicate" })).toHaveAttribute(
      "title",
      "report duplication is not available yet",
    );
    fireEvent.keyDown(document, { key: "Escape" });
    report.focus();
    fireEvent.keyDown(report, { key: "F10", shiftKey: true });
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeEnabled();
  });

  it("Delete on a focused artifact row routes to the registry's confirmed delete", () => {
    // The swallowed-keystroke fall-through was explicitly "until a registry
    // action defines artifact deletion" — E-b2 is that registry, so the key
    // now routes through the SAME confirm the menu uses.
    vi.mocked(askConfirm).mockResolvedValue(true as never);
    render(<Harness />);
    row("report:rep1").focus();
    fireEvent.keyDown(row("report:rep1"), { key: "Delete" });
    expect(askConfirm).toHaveBeenCalledWith(
      'Delete "My Report"?',
      expect.stringContaining("cannot be recovered"),
      "Delete",
      true,
    );
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
