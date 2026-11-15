import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { readFunctionDef } from "../../../lib/functionPlot";
import { useApp } from "../../../store/useApp";
import FunctionPlotPanel from "./FunctionPlotPanel";

const base = {
  time: [0, 1, 2, 3],
  values: [[10], [11], [12], [13]],
  labels: ["Signal"],
  units: [""],
  metadata: {},
};

describe("FunctionPlotPanel", () => {
  beforeEach(() => {
    useApp.setState({ datasets: [], activeId: null, functionPlotOpen: true });
    useApp.getState().addDataset({ id: "base", name: "Base", data: base });
  });

  it("adds the function as a live curve on the focused graph and edits it live", () => {
    render(<FunctionPlotPanel />);
    fireEvent.change(screen.getByLabelText("Function expression"), { target: { value: "a*x" } });
    fireEvent.change(screen.getByLabelText("Parameter a"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to graph" }));

    const s = useApp.getState();
    const fn = s.datasets.find((d) => readFunctionDef(d));
    expect(fn).toBeTruthy();
    expect(fn!.data.time).toHaveLength(200);
    const graph = s.datasets.find((d) => d.linkedCurves?.some((c) => c.datasetId === fn!.id));
    expect(graph, "the function is a curve on a graph").toBeTruthy();
    expect(graph!.linkedCurves).toHaveLength(2);

    // The curve is now selected: a valid edit rewrites its rows at once.
    fireEvent.change(screen.getByLabelText("Parameter a"), { target: { value: "5" } });
    const edited = useApp.getState().datasets.find((d) => d.id === fn!.id)!;
    expect(edited.data.values[edited.data.values.length - 1][0]).toBeCloseTo(15, 9); // x spans the base data (0..3)
    expect(readFunctionDef(edited)?.params).toEqual({ a: 5 });
  });

  it("refuses an invalid definition and says why", () => {
    render(<FunctionPlotPanel />);
    fireEvent.change(screen.getByLabelText("Function expression"), { target: { value: "a*(" } });
    expect(screen.getByRole("alert").textContent).toBeTruthy();
    expect((screen.getByRole("button", { name: "Add to graph" }) as HTMLButtonElement).disabled).toBe(true);
    act(() => undefined);
  });
});
