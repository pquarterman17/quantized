// Defect found in acceptance: with a Library row focused, the repeat chord
// (Ctrl/Cmd+Backspace) was caught by the Library's own Backspace handler and
// opened "Delete ... Move to trash" (once it removed the dataset). A MODIFIED
// Delete/Backspace is never a delete; it must pass through to the global
// shortcut layer. Every Library surface is exercised through the real
// components with the real global hook mounted.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LibraryDetails from "./LibraryDetails";
import LibraryTree from "./LibraryTree";
import LibraryWorkspace from "./LibraryWorkspace";
import { useLibraryHierarchyModel, useLibraryHierarchyRows } from "./useLibraryHierarchyRows";
import { rememberRepeat, resetLastActionForTests } from "../../lib/lastAction";
import type { Dataset } from "../../lib/types";
import { askConfirm } from "../overlays/ConfirmDialog";
import { askParams } from "../overlays/ParamDialog";
import { useApp } from "../../store/useApp";
import { useGlobalShortcuts } from "../../useGlobalShortcuts";

vi.mock("../overlays/ParamDialog", () => ({ askParams: vi.fn() }));
vi.mock("../overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));

const ds = (id: string): Dataset => ({
  id,
  name: `${id}.csv`,
  workbookId: "w",
  data: { time: [0, 1], values: [[1], [2]], labels: ["M"], units: [""], metadata: {} },
});

function TreeHarness() {
  useGlobalShortcuts();
  return <LibraryTree rows={useLibraryHierarchyRows()} onFilterTag={() => {}} />;
}
function DetailsHarness() {
  useGlobalShortcuts();
  return <LibraryDetails hierarchy={useLibraryHierarchyModel().hierarchy} />;
}
function TilesHarness() {
  useGlobalShortcuts();
  return <LibraryWorkspace onClose={() => {}} />;
}

const bySel = (sel: string) => (): HTMLElement => document.querySelector(sel) as HTMLElement;
const SURFACES = [
  { name: "tree", Harness: TreeHarness, row: bySel('[data-ds-id="d1"]') },
  { name: "details", Harness: DetailsHarness, row: bySel('[data-lib-row="worksheet:d1"]') },
  { name: "tiles", Harness: TilesHarness, row: () => screen.getByRole("listitem", { name: "d1.csv, Worksheet" }) },
] as const;

// Chords that must never delete. Ctrl/Cmd+Backspace additionally repeat.
const NEVER_DELETE: [string, KeyboardEventInit][] = [
  ["Ctrl+Backspace", { key: "Backspace", ctrlKey: true }],
  ["Cmd+Backspace", { key: "Backspace", metaKey: true }],
  ["Ctrl+Shift+Backspace", { key: "Backspace", ctrlKey: true, shiftKey: true }],
  ["Alt+Backspace", { key: "Backspace", altKey: true }],
  ["Ctrl+Delete", { key: "Delete", ctrlKey: true }],
  ["Cmd+Delete", { key: "Delete", metaKey: true }],
];
const REPEATS: [string, KeyboardEventInit][] = [
  ["Ctrl+Backspace", { key: "Backspace", ctrlKey: true }],
  ["Cmd+Backspace", { key: "Backspace", metaKey: true }],
];
const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 40)));

beforeEach(() => {
  resetLastActionForTests();
  vi.mocked(askParams).mockReset();
  vi.mocked(askParams).mockResolvedValue(false as never); // a prompt is observed, never accepted
  vi.mocked(askConfirm).mockReset();
  vi.mocked(askConfirm).mockResolvedValue(false as never);
  useApp.setState({
    folders: [],
    workbooks: [{ id: "w", name: "Run" }],
    datasets: [ds("d1"), ds("d2")],
    originFigures: [],
    editableFigures: [],
    figureDocs: [],
    pages: [],
    reports: [],
    librarySelection: { kind: "workbook", id: "w" },
    expandedWorkbookIds: ["w"],
    workbookLastChild: {},
    activeId: "d1",
    selectedIds: ["d1"],
    trash: [],
    history: [],
    confirmRemove: true, // a delete would raise the "Delete ... Move to trash" prompt
  });
});

const untouched = () => {
  const s = useApp.getState();
  expect(askParams).not.toHaveBeenCalled();
  expect(askConfirm).not.toHaveBeenCalled();
  expect(s.datasets.map((d) => d.id)).toEqual(["d1", "d2"]);
  expect(s.trash).toHaveLength(0);
};

describe.each(SURFACES)("Library $name: a modified Backspace/Delete on a focused row", ({ Harness, row }) => {
  it.each(NEVER_DELETE)("%s does not open the delete dialog or remove the dataset", async (_n, init) => {
    render(<Harness />);
    row().focus();
    fireEvent.keyDown(row(), { cancelable: true, bubbles: true, ...init });
    await flush();
    untouched();
  });

  it.each(REPEATS)("%s reaches the repeat command", async (_n, init) => {
    const run = vi.fn();
    rememberRepeat({ label: "Smooth", run });
    render(<Harness />);
    row().focus();
    fireEvent.keyDown(row(), { cancelable: true, bubbles: true, ...init });
    await flush();
    expect(run).toHaveBeenCalledOnce();
    untouched();
  });

  it.each(["Delete", "Backspace"])("plain %s still opens the delete confirmation for that row", async (key) => {
    render(<Harness />);
    row().focus();
    fireEvent.keyDown(row(), { key, cancelable: true, bubbles: true });
    await flush();
    expect(askParams).toHaveBeenCalledOnce();
    expect(useApp.getState().datasets).toHaveLength(2);
  });
});

describe("Library: the chord is not swallowed by the non-row belts", () => {
  it("Details: a sort-header button passes the chord on, plain Delete is still consumed", async () => {
    const run = vi.fn();
    rememberRepeat({ label: "Smooth", run });
    render(<DetailsHarness />);
    const header = screen.getAllByRole("button").find((b) => !b.closest("[data-lib-row]") && /name/i.test(b.textContent ?? ""))!;
    header.focus();
    fireEvent.keyDown(header, { key: "Backspace", ctrlKey: true, cancelable: true, bubbles: true });
    await flush();
    expect(run).toHaveBeenCalledOnce();
    untouched();
    fireEvent.keyDown(header, { key: "Delete", cancelable: true, bubbles: true });
    await flush();
    untouched(); // consumed, not routed to the global dataset removal
  });

  it("Tree: the chord from a nested non-editor control in a row repeats instead of being eaten", async () => {
    const run = vi.fn();
    rememberRepeat({ label: "Smooth", run });
    render(<TreeHarness />);
    const nested = document.querySelector('[data-ds-id="d1"] button') as HTMLElement | null;
    const target = nested ?? (document.querySelector('[data-ds-id="d1"]') as HTMLElement);
    target.focus();
    fireEvent.keyDown(target, { key: "Backspace", ctrlKey: true, cancelable: true, bubbles: true });
    await flush();
    expect(run).toHaveBeenCalledOnce();
    untouched();
  });
});
