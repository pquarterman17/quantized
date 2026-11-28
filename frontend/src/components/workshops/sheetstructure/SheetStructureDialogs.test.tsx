// The pivot and Insert-into-similar-sheets dialogs through their real entry point (the worksheet
// toolbar's Columns menu), with the store as the witness: the new worksheet's numbers, the refusal on a
// repeated pair, the rule that combines it, one undo step, and the all-or-nothing insert.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadFormulaExtension } from "../../../lib/formulaExt";
import type { Dataset } from "../../../lib/types";
import { insertIntoSimilar } from "../../../store/insertSimilar";
import { useApp } from "../../../store/useApp";
import WorksheetPane from "../../Stage/worksheet/WorksheetPane";
import { closeSheetStructure } from "./openSheetStructure";

const st = () => useApp.getState();
const named = (name: string): Dataset | undefined => st().datasets.find((d) => d.name === name);

const long = (extra: Partial<Dataset> = {}): Dataset => ({
  id: "long",
  name: "Long",
  data: {
    time: [0, 0, 0, 0, 0, 0],
    values: [[1, 10, 1.5], [1, 20, 2.5], [2, 10, 3.5], [2, 20, 4.5], [3, 10, 5.5], [3, 30, 6.5]],
    labels: ["t", "key", "val"],
    units: ["s", "", "V"],
    metadata: {},
  },
  ...extra,
});

async function openFrom(entry: string): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: /^Columns/ }));
  fireEvent.click(await screen.findByText(entry));
}

beforeEach(async () => {
  await loadFormulaExtension();
  useApp.setState({
    datasets: [long()],
    activeId: "long",
    worksheetId: null,
    history: [],
    future: [],
    status: "",
    recalcMode: "auto",
    staleDatasets: [],
    analysisResults: [],
    plotWindows: [],
    layoutMode: "classic",
    namedRanges: [],
  } as Partial<ReturnType<typeof useApp.getState>>);
});

afterEach(() => {
  for (const k of ["pivot", "insert-similar", "column-list"]) closeSheetStructure(k);
});

describe("Pivot", () => {
  async function pivotWith(time: string, rule?: string): Promise<void> {
    render(<WorksheetPane datasetId="long" />);
    await openFrom("Pivot…");
    fireEvent.change(await screen.findByLabelText("Time column"), { target: { value: time } });
    fireEvent.change(screen.getByLabelText("Key column"), { target: { value: "c1" } });
    fireEvent.change(screen.getByLabelText("Value column"), { target: { value: "2" } });
    if (rule) fireEvent.change(screen.getByLabelText("Duplicate rule"), { target: { value: rule } });
  }

  it("long to wide: a new worksheet, a column per key, missing cells NaN, the source untouched, one undo", async () => {
    await pivotWith("0");
    expect(screen.getByRole("status", { name: "Preview" }).textContent).toContain("3 rows x 3 columns");
    fireEvent.click(screen.getByRole("button", { name: "Create worksheet" }));
    await waitFor(() => expect(named("Long (pivot)")).toBeDefined());
    const out = named("Long (pivot)")!;
    expect(out.data.time).toEqual([1, 2, 3]);
    expect(out.data.labels).toEqual(["10", "20", "30"]);
    expect(out.data.values[0]).toEqual([1.5, 2.5, Number.NaN]);
    expect(out.data.values[1]).toEqual([3.5, 4.5, Number.NaN]);
    expect(out.data.values[2]).toEqual([5.5, Number.NaN, 6.5]);
    expect(out.data.units).toEqual(["V", "V", "V"]);
    expect(named("Long")!.data.values).toHaveLength(6); // the source is unchanged
    act(() => st().undo());
    expect(named("Long (pivot)")).toBeUndefined();
  });

  it("a repeated (time, key) is refused by default, naming the pair, and combined by the rule picked", async () => {
    useApp.setState({ datasets: [long({ data: { ...long().data, values: [...long().data.values, [1, 10, 9.5]] , time: [0, 0, 0, 0, 0, 0, 0] } })] });
    await pivotWith("0");
    expect(screen.getByRole("status", { name: "Preview" }).textContent).toMatch(/more than one row for "10"/);
    expect(screen.getByRole("button", { name: "Create worksheet" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Duplicate rule"), { target: { value: "mean" } });
    fireEvent.click(screen.getByRole("button", { name: "Create worksheet" }));
    await waitFor(() => expect(named("Long (pivot)")).toBeDefined());
    expect(named("Long (pivot)")!.data.values[0][0]).toBeCloseTo((1.5 + 9.5) / 2, 12);
    expect(st().status).toMatch(/combined by mean/);
  });

  it("wide to long stacks the chosen columns under a categorical key", async () => {
    useApp.setState({
      datasets: [{ id: "wide", name: "Wide", data: { time: [1, 2], values: [[1, 2], [3, Number.NaN]], labels: ["a", "b"], units: ["", ""], metadata: {} } }],
      activeId: "wide",
    });
    render(<WorksheetPane datasetId="wide" />);
    await openFrom("Pivot…");
    fireEvent.click(await screen.findByLabelText(/Wide to long/));
    fireEvent.click(screen.getByLabelText("Skip empty cells"));
    fireEvent.click(screen.getByRole("button", { name: "Create worksheet" }));
    await waitFor(() => expect(named("Wide (stacked)")).toBeDefined());
    const out = named("Wide (stacked)")!;
    expect(out.data.time).toEqual([1, 2, 1]);
    expect(out.data.values.map((r) => r[0])).toEqual([0, 0, 1]);
    expect(out.data.values.map((r) => r[1])).toEqual([1, 3, 2]);
    expect(out.data.cat_levels?.[0]).toEqual(["a", "b"]);
  });
});

describe("Insert column into similar sheets", () => {
  const sheet = (id: string, labels: string[], extra: Partial<Dataset> = {}): Dataset => ({
    id,
    name: id.toUpperCase(),
    data: { time: [0, 1], values: [labels.map(() => 1), labels.map(() => 2)], labels, units: labels.map(() => ""), metadata: {} },
    ...extra,
  });

  beforeEach(() => {
    useApp.setState({
      datasets: [sheet("a", ["x1", "x2"]), sheet("b", ["x1", "x2"]), sheet("c", ["x1", "x3"]), sheet("d", ["x1", "x2"], { protectedSheet: true })],
      activeId: "a",
      history: [],
    });
  });

  async function open(): Promise<void> {
    render(<WorksheetPane datasetId="a" />);
    await openFrom("Insert column into similar sheets…");
    await screen.findByLabelText("Column name");
  }

  it("lists the affected sheets before applying, and names the similar sheet that cannot take it", async () => {
    await open();
    expect(screen.getByRole("list", { name: "Sheets that will change" }).textContent).toContain("A (this sheet)");
    expect(screen.getByRole("list", { name: "Sheets that will change" }).textContent).toContain("B");
    expect(screen.getByRole("list", { name: "Sheets that will change" }).textContent).not.toContain("C"); // other layout
    expect(screen.getByRole("list", { name: "Sheets that cannot change" }).textContent).toMatch(/D: .*protected/);
  });

  it("lists a sheet that differs only in units as not similar, and includes it only when asked", async () => {
    const withUnits = (id: string, units: string[], extra: Partial<Dataset> = {}): Dataset => {
      const d = sheet(id, ["x1", "x2"], extra);
      return { ...d, data: { ...d.data, units } };
    };
    useApp.setState({
      datasets: [withUnits("a", ["V", "A"]), withUnits("b", ["V", "A"]), withUnits("e", ["mV", "A"]), withUnits("f", ["V", "A"], { columnDesignations: { 1: "Y-error" } })],
    });
    await open();
    expect(screen.getByRole("list", { name: "Sheets that will change" }).textContent).not.toContain("E");
    const notSimilar = screen.getByRole("list", { name: "Sheets that are not similar" }).textContent ?? "";
    expect(notSimilar).toContain("E: not similar: units differ");
    expect(notSimilar).toContain("F: not similar: designations differ");
    fireEvent.change(screen.getByLabelText("Column name"), { target: { value: "sum" } });
    fireEvent.click(screen.getByRole("button", { name: /^Insert into 2 sheets/ }));
    await waitFor(() => expect(named("B")!.data.labels).toEqual(["x1", "x2", "sum"]));
    expect(named("E")!.data.labels).toEqual(["x1", "x2"]);
    expect(named("F")!.data.labels).toEqual(["x1", "x2"]);
  });

  it("includes the not-similar sheets when the option is ticked", async () => {
    const d = sheet("e", ["x1", "x2"]);
    useApp.setState({ datasets: [...st().datasets, { ...d, data: { ...d.data, units: ["mV", ""] } }] });
    await open();
    fireEvent.click(screen.getByLabelText("Include sheets that are not similar"));
    expect(screen.getByRole("list", { name: "Sheets that will change" }).textContent).toContain("E");
    fireEvent.change(screen.getByLabelText("Column name"), { target: { value: "sum" } });
    fireEvent.click(screen.getByRole("button", { name: /^Insert into 3 sheets/ }));
    await waitFor(() => expect(named("E")!.data.labels).toEqual(["x1", "x2", "sum"]));
    expect(named("A")!.data.labels).toEqual(["x1", "x2", "sum"]);
    expect(named("D")!.data.labels).toEqual(["x1", "x2"]); // protected: still refused
  });

  it("inserts a formula column into every similar sheet as one undo step", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Column name"), { target: { value: "sum" } });
    fireEvent.change(screen.getByLabelText("Column formula"), { target: { value: "A + B" } });
    fireEvent.click(screen.getByRole("button", { name: /^Insert into 2 sheets/ }));
    await waitFor(() => expect(named("A")!.data.labels).toEqual(["x1", "x2", "sum"]));
    expect(named("B")!.data.values.map((r) => r[2])).toEqual([2, 4]);
    expect(named("A")!.formulas?.[0].expr).toBe("A + B");
    expect(named("C")!.data.labels).toEqual(["x1", "x3"]);
    expect(named("D")!.data.labels).toEqual(["x1", "x2"]);
    expect(st().history).toHaveLength(1);
    act(() => st().undo());
    expect(named("A")!.data.labels).toEqual(["x1", "x2"]);
    expect(named("B")!.data.labels).toEqual(["x1", "x2"]);
  });

  it("a blank column takes its name and designation", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Column name"), { target: { value: "err" } });
    fireEvent.change(screen.getByLabelText("Column designation"), { target: { value: "label" } });
    fireEvent.click(screen.getByLabelText("Include B")); // leave B out
    fireEvent.click(screen.getByRole("button", { name: /^Insert into 1 sheet$/ }));
    await waitFor(() => expect(named("A")!.data.labels).toEqual(["x1", "x2", "err"]));
    expect(named("A")!.columnDesignations?.[2]).toBe("label");
    expect(named("A")!.data.values.map((r) => r[2])).toEqual([Number.NaN, Number.NaN]);
    expect(named("B")!.data.labels).toEqual(["x1", "x2"]);
  });

  it("is all or nothing: a refusal on one sheet leaves every sheet as it was", async () => {
    useApp.setState({ datasets: [...st().datasets.map((d) => (d.id === "b" ? { ...d, data: { ...d.data, labels: ["x1", "x2"], metadata: { x_column_name: "sum" } } } : d))] });
    await open();
    fireEvent.change(screen.getByLabelText("Column name"), { target: { value: "sum" } });
    fireEvent.click(screen.getByRole("button", { name: /^Insert into 2 sheets/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/already has a column named "sum"/);
    expect(named("A")!.data.labels).toEqual(["x1", "x2"]);
    expect(st().history).toHaveLength(0);
  });

  it("rolls back the sheets already written when a later one refuses (a protected sheet picked by id)", () => {
    for (const spec of [{ name: "n", expr: "A + B", designation: "Y" as const }, { name: "n", expr: "", designation: "Y" as const }]) {
      const r = insertIntoSimilar(["a", "d"], spec);
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.error).toMatch(/D: .*protected.*nothing was changed/);
      expect(named("A")!.data.labels).toEqual(["x1", "x2"]);
      expect(named("A")!.formulas).toBeUndefined();
      expect(st().history).toHaveLength(0);
    }
  });
});
