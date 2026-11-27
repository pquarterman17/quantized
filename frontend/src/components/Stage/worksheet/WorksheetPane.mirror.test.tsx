// Mirror columns through the REAL worksheet: the header badge (Linked /
// Missing), the header and cell menus, the refused edit (status line AND
// toast), Detach from the menu, and Go to Source landing on the source
// worksheet with its column selected.

import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { loadFormulaExtension } from "../../../lib/formulaExt";
import type { Dataset } from "../../../lib/types";
import { createMirror } from "../../../store/mirrorColumn";
import { useToasts } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import { useWorksheetReveal } from "../../../store/worksheetReveal";
import { allMenuLabels, clickMenuItem } from "../../../test/contextMenuNav";
import WorksheetPane from "./WorksheetPane";

const mk = (id: string, name: string, rows: number[][], labels: string[]): Dataset => ({
  id,
  name,
  data: { time: rows.map((_, i) => i), values: rows, labels, units: labels.map(() => ""), metadata: {} },
});

const cell = (pos: number, col: number): HTMLElement => document.querySelector<HTMLElement>(`[role=gridcell][id$="-r${pos}-c${col + 1}"]`)!;
const header = (col: number): HTMLElement => document.querySelector<HTMLElement>(`[role=columnheader][data-col="${col}"]`)!;

beforeEach(async () => {
  await loadFormulaExtension();
  useApp.setState({
    datasets: [mk("src", "Run 2", [[10, 1], [20, 2], [30, 3]], ["T", "R"]), mk("mir", "Summary", [[100], [200], [300]], ["Q"])],
    activeId: "mir",
    worksheetId: null,
    selection: null,
    selectedIds: [],
    worksheetSelections: {},
    history: [],
    future: [],
    status: "",
    statusDanger: null,
    recalcMode: "auto",
    staleDatasets: [],
  });
  useWorksheetReveal.setState({ rowReveal: null });
});

describe("mirror column in the worksheet", () => {
  it("shows a Linked badge, and Missing once the source worksheet is deleted", () => {
    createMirror("mir", "src", 0);
    render(<WorksheetPane datasetId="mir" />);
    expect(header(1).querySelector(".qzk-mirror-badge")).toHaveTextContent("Linked");
    expect(header(1).title).toMatch(/Mirror: follows Run 2 › T/);
    act(() => useApp.getState().removeDataset("src"));
    const badge = header(1).querySelector(".qzk-mirror-badge")!;
    expect(badge).toHaveTextContent("Missing");
    expect(badge.getAttribute("data-state")).toBe("missing");
  });

  it("states a row-count difference in the badge", () => {
    useApp.setState({ datasets: [mk("src", "Run 2", [[1, 1], [2, 2], [3, 3], [4, 4]], ["T", "R"]), mk("mir", "Summary", [[1], [2]], ["Q"])] });
    createMirror("mir", "src", 0);
    render(<WorksheetPane datasetId="mir" />);
    const badge = header(1).querySelector(".qzk-mirror-badge")!;
    expect(badge).toHaveTextContent("rows differ");
    expect(badge.getAttribute("title")).toMatch(/source has 4 rows, this sheet 2: rows 3-4 are not mirrored/);
  });

  it("typing into a mirror cell is refused with the reason in the status line and a toast", () => {
    createMirror("mir", "src", 0);
    useToasts.setState({ toasts: [] });
    render(<WorksheetPane datasetId="mir" />);
    fireEvent.mouseDown(cell(0, 1), { button: 0 });
    fireEvent.keyDown(document.getElementById(document.querySelector("[role=grid]")!.id)!, { key: "F2" });
    const why = "T (mirror) follows Run 2 › T: edit it there (Go to Source), or Detach to make it ordinary values";
    expect(useApp.getState().status).toBe(why);
    expect(useToasts.getState().toasts.map((t) => t.msg)).toContain(why);
    expect(useApp.getState().datasets.find((d) => d.id === "mir")!.data.values.map((r) => r[1])).toEqual([10, 20, 30]);
  });

  it("the header menu offers Go to Source and Detach on a mirror, Mirror column… on any column", async () => {
    createMirror("mir", "src", 0);
    render(<WorksheetPane datasetId="mir" />);
    fireEvent.contextMenu(header(0), { clientX: 10, clientY: 10 });
    expect(allMenuLabels()).toContain("Mirror column…");
    expect(allMenuLabels().some((l) => l.includes("Go to Source"))).toBe(false);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    fireEvent.contextMenu(header(1), { clientX: 10, clientY: 10 });
    expect(allMenuLabels().some((l) => l.includes("Go to Source (Run 2 › T)"))).toBe(true);
    expect(allMenuLabels()).toContain("Detach (make ordinary values)");
    clickMenuItem("Detach (make ordinary values)");
    await waitFor(() => expect(useApp.getState().datasets.find((d) => d.id === "mir")!.formulas).toBeUndefined());
    expect(useApp.getState().datasets.find((d) => d.id === "mir")!.data.labels).toEqual(["Q", "T"]);
    expect(header(1).querySelector(".qzk-mirror-badge")).toBeNull();
  });

  it("the cell menu's Go to Source opens the source worksheet with its column selected and the same row", async () => {
    createMirror("mir", "src", 1);
    const first = render(<WorksheetPane datasetId="mir" />);
    fireEvent.mouseDown(cell(2, 1), { button: 0 });
    fireEvent.contextMenu(cell(2, 1), { clientX: 20, clientY: 20 });
    clickMenuItem(/Go to Source row 3 \(Run 2 › R\)/);
    await waitFor(() => expect(useWorksheetReveal.getState().rowReveal).not.toBeNull());
    expect(useApp.getState().worksheetId).toBe("src");
    first.unmount();
    render(<WorksheetPane datasetId="src" />); // the Worksheet tab now shows the source
    await waitFor(() => expect(useWorksheetReveal.getState().rowReveal).toBeNull());
    expect(header(1).style.borderBottomWidth).toBe("2px"); // column B (index 1) is selected
    expect(header(0).style.borderBottomWidth).not.toBe("2px");
    expect(JSON.stringify(useApp.getState().worksheetSelections)).toContain("[2]"); // row 3 selected
  });

  it("the header menu's Go to Source selects ONLY the source column, no row", async () => {
    createMirror("mir", "src", 0);
    const first = render(<WorksheetPane datasetId="mir" />);
    fireEvent.contextMenu(header(1), { clientX: 10, clientY: 10 });
    clickMenuItem(/Go to Source/);
    await waitFor(() => expect(useWorksheetReveal.getState().rowReveal).not.toBeNull());
    first.unmount();
    render(<WorksheetPane datasetId="src" />);
    await waitFor(() => expect(useWorksheetReveal.getState().rowReveal).toBeNull());
    expect(header(0).style.borderBottomWidth).toBe("2px");
    expect(useApp.getState().selection).toBeNull();
  });
});
