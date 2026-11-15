import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { readFunctionDef } from "../../../lib/functionPlot";
import { useApp } from "../../../store/useApp";
import FunctionPlotPanel from "./FunctionPlotPanel";

const base = {
  time: [0, 1, 2, 3],
  values: [[10, 20, 30], [11, 21, 31], [12, 22, 32], [13, 23, 33]],
  labels: ["A", "B", "C"],
  units: ["", "", ""],
  metadata: {},
};

const fnCurve = () => useApp.getState().datasets.find((d) => readFunctionDef(d));
const graph = () => useApp.getState().datasets.find((d) => d.linkedCurves);
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const lastY = () => {
  const v = fnCurve()!.data.values;
  return v[v.length - 1][0];
};

describe("FunctionPlotPanel", () => {
  beforeEach(() => {
    useApp.setState({ datasets: [], activeId: null, history: [], future: [] });
    useApp.getState().addDataset({ id: "base", name: "Base", data: base });
    useApp.setState({ history: [], future: [] });
  });

  function addA(a: string) {
    render(<FunctionPlotPanel />);
    type("Function expression", "a*x");
    type("Parameter a", a);
    fireEvent.click(screen.getByRole("button", { name: "Add to graph" }));
  }

  it("adds the function as a live curve on the focused graph and edits it live", () => {
    addA("2");
    expect(fnCurve()!.data.time).toHaveLength(200);
    expect(graph()!.linkedCurves!.some((c) => c.datasetId === fnCurve()!.id)).toBe(true);
    type("Parameter a", "5");
    expect(lastY()).toBeCloseTo(15, 9); // x spans the base data (0..3)
    expect(readFunctionDef(fnCurve())?.params).toEqual({ a: 5 });
  });

  it("keeps the graph the user had: only the plotted channels, plus the function", () => {
    useApp.setState({ yKeys: [1] });
    addA("1");
    const curves = graph()!.linkedCurves!;
    expect(curves.map((c) => [c.datasetId, c.yKey])).toEqual([["base", 1], [fnCurve()!.id, 0]]);
  });

  it("is one undo step per Add, with no orphan function dataset left", () => {
    addA("1");
    expect(useApp.getState().history.map((h) => h.label)).toEqual(["add function curve"]);
    useApp.getState().undo();
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["base"]);
  });

  it("records every edit after an Undo, and the form follows the undone curve", () => {
    addA("1");
    type("Parameter a", "5");
    act(() => useApp.getState().undo()); // back to a = 1
    expect(readFunctionDef(fnCurve())?.params).toEqual({ a: 1 });
    expect((screen.getByLabelText("Parameter a") as HTMLInputElement).value).toBe("1");
    type("Parameter a", "7");
    expect(readFunctionDef(fnCurve())?.params).toEqual({ a: 7 });
    expect(useApp.getState().history.at(-1)?.label).toBe("edit function plot");
    act(() => useApp.getState().undo());
    expect(readFunctionDef(fnCurve())?.params).toEqual({ a: 1 });
    expect(graph(), "the second undo must not also remove the graph").toBeTruthy();
  });

  it("updates the legend and export label when the expression is edited", () => {
    addA("1");
    type("Function expression", "a*x^2");
    expect(graph()!.linkedCurves!.at(-1)!.label).toBe("y = a*x^2");
    expect(graph()!.data.labels.at(-1)).toBe("y = a*x^2");
  });

  it("opening the panel on a function curve writes nothing and adds no undo step", () => {
    addA("3");
    const before = fnCurve()!.data;
    const steps = useApp.getState().history.length;
    useApp.setState({ activeId: fnCurve()!.id });
    render(<FunctionPlotPanel />);
    expect(fnCurve()!.data).toBe(before);
    expect(useApp.getState().history).toHaveLength(steps);
  });

  it("refuses an invalid definition and says why", () => {
    render(<FunctionPlotPanel />);
    type("Function expression", "a*(");
    expect(screen.getByRole("alert").textContent).toBeTruthy();
    expect((screen.getByRole("button", { name: "Add to graph" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("refuses row-dependent functions instead of crashing, also while editing live", () => {
    addA("2");
    const before = fnCurve()!.data;
    for (const bad of ["diff(x)", "row()", "lag(x,1)", "mean(x)", "cumsum(x)"]) {
      type("Function expression", bad);
      expect(screen.getByRole("alert").textContent, bad).toMatch(/function of x alone|row/);
      expect(fnCurve()!.data, bad).toBe(before);
    }
    expect((screen.getByRole("button", { name: "Add as new curve" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("treats a cleared parameter as a problem, not a silent zero", () => {
    addA("2");
    type("Parameter a", "");
    expect(screen.getByRole("alert").textContent).toMatch(/enter a value for a/);
    expect(readFunctionDef(fnCurve())?.params).toEqual({ a: 2 });
  });

  it("falls back to a new curve when the selected curve is deleted", () => {
    addA("2");
    const id = fnCurve()!.id;
    act(() => useApp.setState((s) => ({ datasets: s.datasets.filter((d) => d.id !== id && !d.linkedCurves) })));
    expect(screen.queryByText(/Editing live/)).toBeNull();
    expect((screen.getByRole("button", { name: "Add to graph" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("starts a new curve on the x range of the focused graph when it changes", () => {
    render(<FunctionPlotPanel />);
    const other = { ...base, time: [100, 200, 300, 400] };
    act(() => useApp.getState().addDataset({ id: "o", name: "Other", data: other }));
    expect((screen.getByLabelText("x min") as HTMLInputElement).value).toBe("100");
    expect((screen.getByLabelText("x max") as HTMLInputElement).value).toBe("400");
  });
});
