// Protected-sheet structure locks and the Show formulas palette entry, through the real worksheet pane:
// the grid's type badge, the column header menu, the Column list's designation control, and the command
// that toggles Show formulas on the worksheet in front.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildAppActions } from "../../../appCommands";
import { loadFormulaExtension } from "../../../lib/formulaExt";
import { PROTECTED_NOTICE } from "../../../lib/sheetProtection";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { allMenuLabels } from "../../../test/contextMenuNav";
import { closeSheetStructure } from "../../workshops/sheetstructure/openSheetStructure";
import WorksheetPane from "./WorksheetPane";

const st = () => useApp.getState();
const sheet = (): Dataset => st().datasets.find((d) => d.id === "w")!;
const cell = (pos: number, col: number): HTMLElement => document.querySelector<HTMLElement>(`[role=gridcell][id$="-r${pos}-c${col + 1}"]`)!;
const mk = (over: Partial<Dataset> = {}): Dataset => ({
  id: "w",
  name: "Run 1",
  data: { time: [0, 1, 2], values: [[3, 30], [1, 10], [2, 20]], labels: ["Temp", "Field"], units: ["K", "Oe"], metadata: {} },
  ...over,
});
const palette = (id: string) => buildAppActions(useApp.getState).find((a) => a.id === id)!;

beforeEach(async () => {
  await loadFormulaExtension();
  useApp.setState({
    datasets: [mk()],
    activeId: "w",
    worksheetId: null,
    history: [],
    future: [],
    status: "",
    recalcMode: "auto",
    staleDatasets: [],
    plotWindows: [],
    layoutMode: "classic",
    stageTab: "worksheet",
  } as Partial<ReturnType<typeof useApp.getState>>);
});
afterEach(() => closeSheetStructure("column-list"));

describe("a protected sheet's column type and Set As", () => {
  it("the grid draws no type badge and the header menu offers no Set As or type pick", () => {
    render(<WorksheetPane datasetId="w" />);
    expect(screen.queryAllByLabelText(/^Modeling type of column/).length).toBeGreaterThan(0); // editable sheet: badge
    act(() => useApp.setState({ datasets: [mk({ protectedSheet: true })] }));
    expect(screen.queryAllByLabelText(/^Modeling type of column/)).toHaveLength(0);
    fireEvent.contextMenu(document.querySelector('[role="columnheader"][data-col="0"]')!, { clientX: 30, clientY: 10 });
    const labels = allMenuLabels();
    expect(labels.some((l) => /^Set As/.test(l))).toBe(false);
    expect(labels.some((l) => /Modeling type|Continuous|Nominal/.test(l))).toBe(false);
  });

  it("the Column list's designation control is refused with the reason", async () => {
    useApp.setState({ datasets: [mk({ protectedSheet: true })] });
    render(<WorksheetPane datasetId="w" />);
    fireEvent.click(screen.getByRole("button", { name: /^Columns/ }));
    fireEvent.click(await screen.findByText("Column list…"));
    const designation = await screen.findByLabelText("Designation, column B");
    fireEvent.change(designation, { target: { value: "Y-error" } });
    await waitFor(() => expect(st().status).toBe(PROTECTED_NOTICE));
    expect(sheet().columnDesignations).toBeUndefined();
    expect(st().history).toHaveLength(0);
  });
});

describe("Show formulas from the palette", () => {
  it("toggles the worksheet in front (the classic Worksheet tab) and back", () => {
    st().addFormula("w", "Sum", "Temp + Field");
    render(<WorksheetPane datasetId="w" />);
    expect(cell(0, 2).textContent).toBe("33.0000");
    act(() => palette("show-formulas").run());
    expect(cell(0, 2).textContent).toBe("A + B");
    act(() => palette("show-formulas").run());
    expect(cell(0, 2).textContent).toBe("33.0000");
  });

  it("acts on the FRONT worksheet window, not the other one", () => {
    st().addFormula("w", "Sum", "Temp + Field");
    useApp.setState({
      layoutMode: "windows",
      windowLayout: { placements: { "plot:a": { open: true }, "plot:b": { open: true } } },
      plotWindows: [
        { id: "a", kind: "worksheet", datasetId: "w", z: 5 },
        { id: "b", kind: "worksheet", datasetId: "w", z: 9 },
      ],
    } as unknown as Partial<ReturnType<typeof useApp.getState>>);
    render(
      <>
        <div data-testid="a"><WorksheetPane datasetId="w" windowId="a" /></div>
        <div data-testid="b"><WorksheetPane datasetId="w" windowId="b" /></div>
      </>,
    );
    act(() => palette("show-formulas").run());
    const inA = screen.getByTestId("a").querySelector('[role=gridcell][id$="-r0-c3"]')!.textContent;
    const inB = screen.getByTestId("b").querySelector('[role=gridcell][id$="-r0-c3"]')!.textContent;
    expect(inB).toBe("A + B");
    expect(inA).toBe("33.0000");
  });

  it("says why when a sheet has no formula column, and when no worksheet is in front", () => {
    render(<WorksheetPane datasetId="w" />);
    act(() => palette("show-formulas").run());
    expect(st().status).toMatch(/no formula columns/);
    useApp.setState({ stageTab: "plot", status: "" });
    act(() => palette("show-formulas").run());
    expect(st().status).toMatch(/No worksheet is in front/);
  });
});
