// u8 (acceptance pass 5): the row-number gutter's right-click menu. Mask row stays its
// FIRST item (that is what right-click there always did, and its title said so); with a
// row selection the same actions the toolbar's "Row selection" cluster offers follow it:
// Exclude, Keep only, Use as row range, Deselect. Through the real worksheet and store.

import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { excludedSet } from "../../../lib/rowstate";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { allMenuLabels, clickMenuItem, findMenuItem } from "../../../test/contextMenuNav";
import WorksheetPane from "./WorksheetPane";

const ds = (): Dataset => ({
  id: "d",
  name: "rr",
  data: { time: [1, 2, 3, 4, 5, 6], values: [[1], [2], [3], [4], [5], [6]], labels: ["y"], units: [""], metadata: {} },
});
const gutter = (row: number): HTMLElement => [...document.querySelectorAll<HTMLElement>("[role=rowheader]")].find((e) => e.textContent === String(row + 1))!;
const excluded = () => [...excludedSet(useApp.getState().datasets[0])].sort((a, b) => a - b);
const menuLabels = () => allMenuLabels().filter((l) => l !== "");

beforeEach(() => {
  useApp.setState({
    datasets: [ds()],
    activeId: "d",
    worksheetId: null,
    selection: null,
    selectedIds: [],
    worksheetSelections: {},
    history: [],
    future: [],
    status: "",
    statusDanger: null,
  });
});

describe("row-number gutter right-click menu", () => {
  it("with nothing selected it is the old row menu, Mask row first, and no selection entries", () => {
    render(<WorksheetPane datasetId="d" />);
    fireEvent.contextMenu(gutter(2), { clientX: 10, clientY: 10 });
    const labels = menuLabels();
    expect(labels[0]).toBe("Mask row");
    expect(labels).not.toContain("Keep only");
    expect(labels).not.toContain("Use as row range");
  });

  it("on a selected row it keeps Mask row first and adds the selection actions, which run on the selection", () => {
    render(<WorksheetPane datasetId="d" />);
    fireEvent.click(gutter(1));
    fireEvent.click(gutter(3), { shiftKey: true }); // rows 2-4 (source rows 1..3)
    fireEvent.contextMenu(gutter(2), { clientX: 10, clientY: 10 });
    const labels = menuLabels();
    expect(labels[0]).toBe("Mask row");
    expect(labels).toEqual(expect.arrayContaining(["Exclude", "Keep only", "Use as row range", "Deselect"]));
    expect((findMenuItem("Use as row range") as HTMLButtonElement).getAttribute("aria-disabled")).not.toBe("true");
    clickMenuItem("Exclude");
    expect(excluded()).toEqual([1, 2, 3]);
  });

  it("Keep only masks every row but the selection", () => {
    render(<WorksheetPane datasetId="d" />);
    fireEvent.click(gutter(1));
    fireEvent.click(gutter(2), { shiftKey: true });
    fireEvent.contextMenu(gutter(1), { clientX: 10, clientY: 10 });
    clickMenuItem("Keep only");
    expect(excluded()).toEqual([0, 3, 4, 5]);
  });

  it("Use as row range sets the analysis row window and opens the Analysis Center on it", () => {
    render(<WorksheetPane datasetId="d" />);
    fireEvent.click(gutter(1));
    fireEvent.click(gutter(3), { shiftKey: true });
    fireEvent.contextMenu(gutter(2), { clientX: 10, clientY: 10 });
    clickMenuItem("Use as row range");
    expect(useApp.getState().status).toMatch(/set as the analysis row range/);
    expect(useApp.getState().stageTab).toBe("analysis");
  });

  it("a gapped selection disables Use as row range with the reason", () => {
    render(<WorksheetPane datasetId="d" />);
    fireEvent.click(gutter(0));
    fireEvent.click(gutter(3), { ctrlKey: true });
    fireEvent.contextMenu(gutter(3), { clientX: 10, clientY: 10 });
    const item = findMenuItem("Use as row range");
    expect(item.getAttribute("aria-disabled") === "true" || (item as HTMLButtonElement).disabled).toBe(true);
    expect(item.getAttribute("title") ?? "").toMatch(/Use as row range: /);
  });

  it("a row outside the selection gets only the single-row menu", () => {
    render(<WorksheetPane datasetId="d" />);
    fireEvent.click(gutter(1));
    fireEvent.contextMenu(gutter(4), { clientX: 10, clientY: 10 });
    expect(menuLabels()).not.toContain("Keep only");
  });

  it("Mask row on the gutter still masks just that row", () => {
    render(<WorksheetPane datasetId="d" />);
    fireEvent.contextMenu(gutter(4), { clientX: 10, clientY: 10 });
    clickMenuItem("Mask row");
    expect(excluded()).toEqual([4]);
  });

  it("the gutter's tooltip names the row menu", () => {
    render(<WorksheetPane datasetId="d" />);
    expect(gutter(0).title).toMatch(/right-click for row actions/);
  });
});
