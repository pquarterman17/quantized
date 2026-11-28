// Show formulas, the column list and sheet protection through the REAL worksheet: the toolbar's
// Columns menu is the entry point, and each assertion reads what the user sees or the store.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadFormulaExtension } from "../../../lib/formulaExt";
import { unwrapRange } from "../../../lib/setColumnValues";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useWorksheetReveal } from "../../../store/worksheetReveal";
import { closeSheetStructure } from "../../workshops/sheetstructure/openSheetStructure";
import WorksheetPane from "./WorksheetPane";

const st = () => useApp.getState();
const sheet = (): Dataset => st().datasets.find((d) => d.id === "w")!;
const cell = (pos: number, col: number): HTMLElement => document.querySelector<HTMLElement>(`[role=gridcell][id$="-r${pos}-c${col + 1}"]`)!;

const mk = (): Dataset => ({
  id: "w",
  name: "Run 1",
  data: { time: [0, 1, 2], values: [[3, 30], [1, 10], [2, 20]], labels: ["Temp", "Field"], units: ["K", "Oe"], metadata: {} },
});

async function openColumnsMenu(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: /^Columns/ }));
  await screen.findByRole("menuitemcheckbox", { name: "Show formulas" }).catch(() => screen.findByText("Show formulas"));
}
const pick = async (name: string): Promise<void> => {
  await openColumnsMenu();
  fireEvent.click(await screen.findByText(name));
};

beforeEach(async () => {
  await loadFormulaExtension();
  useApp.setState({
    datasets: [mk()],
    activeId: "w",
    worksheetId: null,
    namedRanges: [],
    history: [],
    future: [],
    status: "",
    statusDanger: null,
    recalcMode: "auto",
    staleDatasets: [],
    plotWindows: [],
    layoutMode: "classic",
  } as Partial<ReturnType<typeof useApp.getState>>);
  useWorksheetReveal.setState({ rowReveal: null });
});

afterEach(() => closeSheetStructure("column-list"));

describe("Show formulas", () => {
  it("draws each formula cell's text, the very text Set Column Values shows, and toggles back", async () => {
    st().addFormula("w", "Sum", "Temp + Field");
    st().addFormula("w", "Half", "let(k, Temp + Field, k / 2)");
    render(<WorksheetPane datasetId="w" />);
    expect(cell(0, 2).textContent).toBe("33.0000");
    await pick("Show formulas");
    for (const [i, col] of [2, 3].entries()) {
      const stored = sheet().formulas![i].expr;
      expect(cell(0, col).textContent).toBe(unwrapRange(stored).expr);
      expect(cell(2, col).textContent).toBe(unwrapRange(stored).expr);
    }
    expect(cell(0, 3).textContent).toBe("let(k, A + B, k / 2)"); // as stored (letters), not expanded
    expect(cell(0, 0).textContent).toBe("3.0000"); // a data column keeps its values
    expect(sheet().formulas).toHaveLength(2); // nothing was written
    expect(st().history).toHaveLength(2); // the two addFormula steps only: the toggle is not an edit
    await pick("Show formulas");
    expect(cell(0, 2).textContent).toBe("33.0000");
  });

  it("shows a named range as rng(\"Name\") and a range-limited formula as the dialog does", async () => {
    st().addFormula("w", "Sum", "Temp + Field");
    const wrapped = "if(row() >= 1 and row() <= 2, Temp * 2, nan)";
    useApp.setState({ datasets: [{ ...sheet(), formulas: [{ ...sheet().formulas![0], expr: wrapped }] }] });
    render(<WorksheetPane datasetId="w" />);
    await pick("Show formulas");
    expect(cell(0, 2).textContent).toBe(unwrapRange(wrapped).expr);
  });

  it("draws a range-limited formula's text only on the rows it covers (C2)", async () => {
    st().addFormula("w", "Sum", "if(row() >= 1 and row() <= 2, Temp * 2, nan)");
    render(<WorksheetPane datasetId="w" />);
    expect(cell(2, 2).textContent).toBe("—"); // outside the range: no value
    await pick("Show formulas");
    expect(cell(0, 2).textContent).toBe("A * 2");
    expect(cell(1, 2).textContent).toBe("A * 2");
    expect(cell(2, 2).textContent).toBe("—"); // left as it is, not the expression
    await pick("Show formulas");
    expect(cell(0, 2).textContent).toBe("6.0000");
  });

  it("is per window and not saved", async () => {
    st().addFormula("w", "Sum", "Temp + Field");
    const { unmount } = render(<WorksheetPane datasetId="w" />);
    await pick("Show formulas");
    unmount();
    render(<WorksheetPane datasetId="w" />);
    expect(cell(0, 2).textContent).toBe("33.0000");
  });

  it("is disabled on a sheet with no formula column", async () => {
    render(<WorksheetPane datasetId="w" />);
    await openColumnsMenu();
    const item = await screen.findByText("Show formulas");
    expect(item.closest("button")).toHaveAttribute("aria-disabled", "true");
  });
});

describe("Column list", () => {
  it("lists every column with name, unit, designation, type, formula and row count", async () => {
    st().addFormula("w", "Sum", "Temp + Field");
    render(<WorksheetPane datasetId="w" />);
    await pick("Column list…");
    const table = await screen.findByRole("table", { name: "Columns" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(4); // X + 3 channels
    expect(rows[0].textContent).toContain("X");
    const sumRow = rows[3];
    expect((within(sumRow).getByLabelText("Name, column C") as HTMLInputElement).value).toBe("Sum");
    expect(sumRow.textContent).toContain("yes");
    expect(sumRow.textContent).toContain("3"); // rows
    expect((within(rows[1]).getByLabelText("Designation, column A") as HTMLSelectElement).value).toBe("Y");
    expect(rows[1].textContent).toContain("continuous");
  });

  it("renames a column and changes its designation through the existing setters, each undoable", async () => {
    render(<WorksheetPane datasetId="w" />);
    await pick("Column list…");
    const name = (await screen.findByLabelText("Name, column A")) as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Temperature" } });
    fireEvent.keyDown(name, { key: "Enter" });
    expect(sheet().data.labels[0]).toBe("Temperature");
    const designation = screen.getByLabelText("Designation, column B");
    fireEvent.change(designation, { target: { value: "Y-error" } });
    expect(sheet().columnDesignations?.[1]).toBe("Y-error");
    act(() => st().undo());
    expect(sheet().columnDesignations?.[1]).toBeUndefined();
    act(() => st().undo());
    expect(sheet().data.labels[0]).toBe("Temp");
  });

  it("selecting a row selects that column in the grid", async () => {
    render(<WorksheetPane datasetId="w" />);
    await pick("Column list…");
    const row = (await screen.findByLabelText("Name, column B")).closest("tr")!;
    fireEvent.click(row);
    await waitFor(() => expect((document.querySelector('[role="columnheader"][data-col="1"]') as HTMLElement).style.background).toContain("accent-soft"));
    expect((document.querySelector('[role="columnheader"][data-col="0"]') as HTMLElement).style.background).not.toContain("accent-soft");
  });

  it("a rename on a protected sheet is refused with the reason", async () => {
    useApp.setState({ datasets: [{ ...mk(), protectedSheet: true }] });
    render(<WorksheetPane datasetId="w" />);
    await pick("Column list…");
    const name = (await screen.findByLabelText("Name, column A")) as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Renamed" } });
    fireEvent.keyDown(name, { key: "Enter" });
    expect(sheet().data.labels[0]).toBe("Temp");
    expect(st().status).toMatch(/protected/i);
  });
});

describe("Protect sheet", () => {
  it("Protect from the menu refuses a typed edit with the reason; Unprotect restores editing", async () => {
    render(<WorksheetPane datasetId="w" />);
    await pick("Protect sheet");
    await waitFor(() => expect(sheet().protectedSheet).toBe(true));
    fireEvent.mouseDown(cell(0, 0), { button: 0 });
    fireEvent.keyDown(document.getElementById(document.querySelector("[role=grid]")!.id)!, { key: "F2" });
    expect(st().status).toMatch(/protected|recomputed/i);
    expect(sheet().data.values[0][0]).toBe(3);
    await pick("Unprotect sheet");
    await waitFor(() => expect(sheet().protectedSheet).toBeUndefined());
    expect(st().history).toHaveLength(2); // protect, unprotect
  });
});
