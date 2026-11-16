// UX8-C: selecting many datasets in the Tree. A plain click there selects
// WITHOUT moving the plotted dataset, and Shift-click used to anchor on the
// plotted one -- so "click row 1, Shift-click row 10" selected ONE row, and
// Ctrl+A selected nothing. Same harness wiring as LibraryTree.test.tsx.

import { act, createEvent, fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import LibraryTree from "./LibraryTree";
import { useLibraryHierarchyRows } from "./useLibraryHierarchyRows";
import type { Dataset } from "../../lib/types";
import type { WorkbookNode } from "../../lib/workbooks";
import { useApp } from "../../store/useApp";

const ds = (id: string, workbookId?: string): Dataset => ({
  id,
  name: `${id}.csv`,
  data: { time: [0, 1], values: [[1], [2]], labels: ["Moment"], units: ["emu"], metadata: {} },
  ...(workbookId ? { workbookId } : {}),
});
const wb = (id: string): WorkbookNode => ({ id, name: id });

function Harness() {
  const rows = useLibraryHierarchyRows();
  return <LibraryTree rows={rows} onFilterTag={() => {}} />;
}

const row = (id: string): HTMLElement => document.querySelector(`[data-ds-id="${id}"]`) as HTMLElement;
const ids = Array.from({ length: 10 }, (_, i) => `m${i}`);

beforeEach(() => {
  // Ten one-sheet workbooks, as importing ten CSVs makes; m9 is plotted.
  useApp.setState({
    folders: [],
    workbooks: ids.map(wb),
    datasets: ids.map((id) => ds(id, id)),
    expandedFolders: [],
    expandedWorkbookIds: ids,
    librarySelection: null,
    activeId: "m9",
    selectedIds: [],
  });
});

describe("LibraryTree multi-selection (UX8-C)", () => {
  it("click the first row, Shift-click the last: all ten are selected", () => {
    render(<Harness />);
    fireEvent.click(row("m0"));
    expect(useApp.getState().selectedIds).toEqual(["m0"]);
    fireEvent.click(row("m9"), { shiftKey: true });
    expect(useApp.getState().selectedIds).toEqual(ids);
    expect(useApp.getState().activeId).toBe("m9"); // the plot never moved
  });

  it("Shift ranges from the last Ctrl-click too", () => {
    render(<Harness />);
    fireEvent.click(row("m2"));
    fireEvent.click(row("m5"), { ctrlKey: true });
    fireEvent.click(row("m7"), { shiftKey: true });
    expect(useApp.getState().selectedIds).toEqual(["m5", "m6", "m7"]);
  });

  it("Shift ranges over the rows as SHOWN, not the store's append order", () => {
    // One workbook whose sheet order keys reverse the display: m9 shows first.
    useApp.setState({
      workbooks: [wb("w")],
      datasets: ids.map((id, i) => ({ ...ds(id, "w"), order: 9 - i })),
      expandedWorkbookIds: ["w"],
      activeId: null,
    });
    render(<Harness />);
    const shown = [...document.querySelectorAll("[data-ds-id]")].map((el) => el.getAttribute("data-ds-id"));
    expect(shown[0]).toBe("m9");
    fireEvent.click(row("m8"));
    fireEvent.click(row("m5"), { shiftKey: true });
    expect(useApp.getState().selectedIds).toEqual(["m8", "m7", "m6", "m5"]);
  });

  it("Ctrl+A on a focused row selects every visible dataset; a collapsed workbook's sheets are not visible", () => {
    useApp.setState({ expandedWorkbookIds: ids.slice(0, 8) });
    render(<Harness />);
    row("m0").focus();
    fireEvent.keyDown(row("m0"), { key: "a", ctrlKey: true });
    expect(useApp.getState().selectedIds).toEqual(ids.slice(0, 8));
    fireEvent.keyDown(row("m0"), { key: "A", metaKey: true });
    expect(useApp.getState().selectedIds).toEqual(ids.slice(0, 8));
    fireEvent.keyDown(row("m0"), { key: "A", ctrlKey: true, shiftKey: true }); // not select-all
    expect(useApp.getState().selectedIds).toEqual(ids.slice(0, 8));
    // From a row's own control (the "⋯" button) too, not the browser's select-all.
    act(() => useApp.getState().selectIds(["m1"]));
    const control = row("m0").querySelector("button")!;
    const ev = createEvent.keyDown(control, { key: "a", ctrlKey: true });
    fireEvent(control, ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(useApp.getState().selectedIds).toEqual(ids.slice(0, 8));
  });
});
