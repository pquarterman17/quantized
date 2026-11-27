// The Name box and the Named Ranges manager through the REAL worksheet pane and stores (ROW_RANGE_CONTRACT 5.5, R4c):
// define a range from a selection, refuse a selection with gaps and a clashing name, rename and watch the formula text
// follow, delete a range that a formula depends on (the dependants dialog, one undo), a stale range and its retarget, and
// go to a range.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadFormulaExtension } from "../../../lib/formulaExt";
import type { Dataset } from "../../../lib/types";
import { useConfirm } from "../../../store/confirmDialog";
import { markRowsReplaced } from "../../../store/rowRangeShift";
import { useApp } from "../../../store/useApp";
import { useWorksheetReveal } from "../../../store/worksheetReveal";
import WorksheetPane from "../../Stage/worksheet/WorksheetPane";
import { closeNamedRangesManager, openNamedRangesManager } from "./openManager";

const N = 30;
const sheet = (id: string, extra: Partial<Dataset> = {}): Dataset => ({
  id,
  name: `${id}.csv`,
  data: {
    time: Array.from({ length: N }, (_v, i) => i),
    values: Array.from({ length: N }, (_v, i) => [i, i * 2, i * 3]),
    labels: ["A", "B", "C"], units: ["", "", ""], metadata: {},
  },
  ...extra,
});
const st = () => useApp.getState();
const header = (col: number) => document.querySelector<HTMLElement>(`[role=columnheader][data-col="${col}"]`)!;
const nameBox = () => screen.getByRole("textbox", { name: "Name box" }) as HTMLInputElement;
const selectRows = (rows: number[]) => act(() => useApp.setState({ selection: { datasetId: "s1", rows } }));
const type = (text: string) => fireEvent.change(nameBox(), { target: { value: text } });
const enter = () => fireEvent.keyDown(nameBox(), { key: "Enter" });
const rows = (n: number, from: number) => Array.from({ length: n }, (_v, i) => from + i);

beforeEach(async () => {
  await loadFormulaExtension();
  useApp.setState({
    datasets: [sheet("s1", { workbookId: "w1" }), sheet("s2", { workbookId: "w1" })],
    workbooks: [{ id: "w1", name: "Run 1" }],
    activeId: "s1", worksheetId: null, selection: null, selectedIds: [], worksheetSelections: {},
    namedRanges: [], history: [], future: [], status: "", recalcMode: "auto", staleDatasets: [],
  });
  useWorksheetReveal.setState({ rowReveal: null });
  useConfirm.getState().close();
});
afterEach(() => closeNamedRangesManager());

describe("Name box: define", () => {
  it("names the selected rows and columns, then shows that name for the selection", async () => {
    render(<WorksheetPane datasetId="s1" />);
    expect(screen.queryByRole("group", { name: "Name box" })).toBeNull(); // nothing selected, no ranges: not shown
    fireEvent.click(header(1)); // column B
    selectRows(rows(7, 3)); // rows 4-10
    await screen.findByRole("textbox", { name: "Name box" }); // the box is a lazy chunk
    type("Base");
    expect(await screen.findByText(/Enter names the selection \(B rows 4-10\)/)).toBeInTheDocument();
    enter();
    expect(st().namedRanges).toHaveLength(1);
    expect(st().namedRanges[0]).toMatchObject({ name: "Base", scope: { kind: "sheet", datasetId: "s1" }, target: { datasetId: "s1", cols: [1], rows: { from: 3, to: 9 } } });
    expect(nameBox().value).toBe("Base");
    expect(screen.getByText(/"Base" names this selection/)).toBeInTheDocument();
    st().undo();
    expect(st().namedRanges).toEqual([]);
  });

  it("the whole-workbook scope is offered for a sheet in a workbook and recorded", async () => {
    render(<WorksheetPane datasetId="s1" />);
    fireEvent.click(header(0));
    selectRows(rows(3, 0));
    fireEvent.change(await screen.findByRole("combobox", { name: "Name scope" }), { target: { value: "workbook" } });
    type("Shared");
    fireEvent.click(screen.getByRole("button", { name: "Define" }));
    expect(st().namedRanges[0].scope).toEqual({ kind: "workbook", workbookId: "w1" });
  });

  it("refuses a selection with gaps, naming them, and defines nothing", async () => {
    render(<WorksheetPane datasetId="s1" />);
    selectRows([1, 2, 5]);
    type("Gappy");
    expect(await screen.findByText(/the selection has gaps \(rows 2-3, 6\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Define" })).toBeDisabled();
    enter();
    expect(st().namedRanges).toEqual([]);
    expect(st().history).toHaveLength(0);
  });

  it("refuses an illegal name and a name already used on a sibling sheet of the workbook", async () => {
    render(<WorksheetPane datasetId="s1" />);
    act(() => useApp.setState({ namedRanges: [{ id: "nr1:x", name: "Taken", scope: { kind: "sheet", datasetId: "s2" }, target: { datasetId: "s2", cols: [0], rows: null } }] }));
    selectRows(rows(3, 0));
    type('bad"name');
    expect(await screen.findByText(/cannot contain quotes/)).toBeInTheDocument();
    type("taken");
    expect(screen.getByText(/"Taken" is already a named range in this workbook/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Define" })).toBeDisabled();
    expect(st().namedRanges).toHaveLength(1);
  });
});

describe("Name box: pick", () => {
  const define = () =>
    act(() => useApp.setState({ namedRanges: [{ id: "nr1:b", name: "Base", scope: { kind: "sheet", datasetId: "s1" }, target: { datasetId: "s1", cols: [1, 2], rows: { from: 3, to: 9 } } }] }));

  it("typing an existing name and Enter selects exactly its rows and columns and asks the grid to scroll there", async () => {
    define();
    render(<WorksheetPane datasetId="s1" />);
    type("base");
    expect(screen.getByText(/Enter selects "Base"/)).toBeInTheDocument();
    enter();
    expect(st().selection).toEqual({ datasetId: "s1", rows: rows(7, 3) });
    expect(await screen.findByText(/"Base" names this selection/)).toBeInTheDocument(); // the box now recognises the selection
    expect(nameBox().value).toBe("Base");
    expect(st().status).toMatch(/selected named range "Base"/);
  });

  it("the Go to list picks a range the same way", () => {
    define();
    render(<WorksheetPane datasetId="s1" />);
    fireEvent.change(screen.getByRole("combobox", { name: "Go to named range" }), { target: { value: "nr1:b" } });
    expect(st().selection).toEqual({ datasetId: "s1", rows: rows(7, 3) });
  });

  it("refuses a stale range with the reason and selects nothing", () => {
    define();
    markRowsReplaced("s1", true);
    render(<WorksheetPane datasetId="s1" />);
    type("Base");
    enter();
    expect(screen.getByText(/rows were replaced; open Named Ranges to keep rows 4-10/)).toBeInTheDocument();
    expect(st().selection).toBeNull();
  });
});

describe("Named Ranges manager", () => {
  const open = () => act(() => openNamedRangesManager());
  const defineAll = () => {
    act(() => useApp.setState({ namedRanges: [{ id: "nr1:b", name: "Base", scope: { kind: "sheet", datasetId: "s1" }, target: { datasetId: "s1", cols: [1], rows: { from: 3, to: 9 } } }] }));
  };

  it("lists the range with its worksheet, columns, rows, scope and use count", () => {
    defineAll();
    expect(st().addFormula("s1", "m", 'mean(rng("Base"))')).toBe(true);
    open();
    const row = screen.getByRole("row", { name: /Base/ });
    expect(row).toHaveTextContent("This sheet");
    expect(row).toHaveTextContent("s1.csv B rows 4-10");
    expect(row).toHaveTextContent("OK");
    expect(within(row).getAllByRole("cell")[4]).toHaveTextContent("1"); // used by one formula column
  });

  it("an empty project says how to make a range", () => {
    open();
    expect(screen.getByText(/type a name in the Name box/)).toBeInTheDocument();
  });

  it("rename rewrites the formula text and one undo restores both", () => {
    defineAll();
    st().addFormula("s1", "m", 'mean(rng("Base"))');
    open();
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.change(screen.getByLabelText("New name for Base"), { target: { value: "Window" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Rename" })[1]);
    expect(st().namedRanges[0].name).toBe("Window");
    expect(st().datasets[0].formulas?.at(-1)?.expr).toBe('mean(rng("Window"))');
    st().undo();
    expect(st().namedRanges[0].name).toBe("Base");
    expect(st().datasets[0].formulas?.at(-1)?.expr).toBe('mean(rng("Base"))');
  });

  it("a rename that clashes is refused in the editor, which stays open", () => {
    act(() => useApp.setState({ namedRanges: [
      { id: "nr1:a", name: "Base", scope: { kind: "sheet", datasetId: "s1" }, target: { datasetId: "s1", cols: [1], rows: null } },
      { id: "nr1:b", name: "Other", scope: { kind: "sheet", datasetId: "s2" }, target: { datasetId: "s2", cols: [1], rows: null } },
    ] }));
    open();
    fireEvent.click(screen.getAllByRole("button", { name: "Rename" })[0]);
    fireEvent.change(screen.getByLabelText("New name for Base"), { target: { value: "other" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Rename" })[1]);
    expect(screen.getByRole("alert")).toHaveTextContent(/"Other" is already a named range/);
    expect(st().namedRanges.map((r) => r.name)).toEqual(["Base", "Other"]);
  });

  it("delete with a dependant lists it, cuts it when confirmed, and one undo restores range and link", async () => {
    defineAll();
    st().addFormula("s1", "m", 'mean(rng("Base"))');
    open();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await screen.findByText("Delete");
    const ask = useConfirm.getState();
    expect(ask.title).toBe('Delete named range "Base"?');
    expect(ask.message).toMatch(/1 thing uses it:\nformula column: /);
    expect(st().namedRanges).toHaveLength(1); // nothing changed yet
    await act(async () => ask.resolve?.(true));
    expect(st().namedRanges).toEqual([]);
    expect(st().datasets[0].formulaErrors && Object.values(st().datasets[0].formulaErrors!).join(" ")).toMatch(/named range .* removed/);
    st().undo();
    expect(st().namedRanges).toHaveLength(1);
    expect(st().datasets[0].formulaErrors).toBeUndefined();
  });

  it("delete cancelled leaves everything", async () => {
    defineAll();
    st().addFormula("s1", "m", 'mean(rng("Base"))');
    open();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await act(async () => useConfirm.getState().resolve?.(false));
    expect(st().namedRanges).toHaveLength(1);
  });

  it("delete of an unused range is immediate", () => {
    defineAll();
    open();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(st().namedRanges).toEqual([]);
  });

  it("a stale range shows why, disables Go to, and Retarget keeps the rows", () => {
    defineAll();
    markRowsReplaced("s1", true);
    open();
    const row = screen.getByRole("row", { name: /Base/ });
    expect(row).toHaveTextContent(/Stale: .*its worksheet's rows were replaced; open Named Ranges to keep rows 4-10/);
    expect(within(row).getByRole("button", { name: "Go to" })).toBeDisabled();
    fireEvent.click(within(row).getByRole("button", { name: "Retarget…" }));
    expect(screen.getByLabelText("First row")).toHaveValue("4");
    expect(screen.getByLabelText("Columns")).toHaveValue("B");
    fireEvent.click(screen.getAllByRole("button", { name: "Retarget" })[0]);
    expect(st().namedRanges[0].rowsStale).toBeUndefined();
    expect(screen.getByRole("row", { name: /Base/ })).toHaveTextContent("OK");
  });

  it("retarget moves the block and a bad entry is refused with its reason", () => {
    defineAll();
    open();
    fireEvent.click(screen.getByRole("button", { name: "Retarget…" }));
    fireEvent.change(screen.getByLabelText("Columns"), { target: { value: "B:D" } });
    fireEvent.click(screen.getByRole("button", { name: "Retarget" }));
    expect(screen.getByRole("alert")).toHaveTextContent("column D is not on the worksheet (it has 3)");
    fireEvent.change(screen.getByLabelText("Columns"), { target: { value: "A:B" } });
    fireEvent.change(screen.getByLabelText("First row"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Last row"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Retarget" }));
    expect(st().namedRanges[0].target).toEqual({ datasetId: "s1", cols: [0, 1], rows: { from: 0, to: 4 } });
  });

  it("the Name box offers the selection as the new block (Use selection)", async () => {
    defineAll();
    render(<WorksheetPane datasetId="s1" />);
    fireEvent.click(header(2)); // C
    selectRows(rows(4, 10));
    fireEvent.click(await screen.findByRole("button", { name: "Named ranges…" }));
    fireEvent.click(screen.getByRole("button", { name: "Use selection" }));
    expect(st().namedRanges[0].target).toEqual({ datasetId: "s1", cols: [2], rows: { from: 10, to: 13 } });
  });
});
