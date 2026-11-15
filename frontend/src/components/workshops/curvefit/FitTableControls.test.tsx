// "Add results table to graph": one undo step, the layer's cells are exactly
// what the export wire carries (screen and export agree), and "Update table"
// rewrites that same layer after a re-fit.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { singleFitTable } from "../../../lib/fitTableLayer";
import { layersWire } from "../../../lib/graphLayersWire";
import { useApp } from "../../../store/useApp";
import FitTableControls from "./FitTableControls";

const fit = (tau: number) => ({ params: [2, tau], errors: [0.1, 0.01], R2: 0.99, chiSqRed: 1.1, chiSq: 5, nPoints: 9 });

let key = 0;
let sourceKey = "single:t0";
function mount(tau: number) {
  return render(<FitTableControls sourceKey={sourceKey} build={(want) => singleFitTable(["A", "tau"], fit(tau), want)} />);
}

beforeEach(() => {
  sourceKey = `single:t${++key}`;
  useApp.setState({ layers: [], history: [], future: [] });
});

describe("FitTableControls", () => {
  it("adds one table layer in one undo step, and the export wire carries the same cells", () => {
    mount(0.5);
    fireEvent.click(screen.getByText("Results table on graph"));
    fireEvent.click(screen.getByRole("button", { name: "Add results table to graph" }));
    const [layer] = useApp.getState().layers;
    expect(layer).toMatchObject({ kind: "table", header: true });
    expect(layer!.kind === "table" && layer!.rows[1]).toEqual(["A", "2.00 ± 0.10"]);
    expect(layer!.kind === "table" && layer!.rows[2]).toEqual(["tau", "0.500 ± 0.010"]);
    expect(layersWire(useApp.getState().layers, [])).toEqual([
      { kind: "table", at: layer!.at, rows: layer!.kind === "table" ? layer!.rows : [], header: true },
    ]);
    useApp.getState().undo();
    expect(useApp.getState().layers).toEqual([]);
  });

  it("honours the chosen statistics", () => {
    mount(0.5);
    fireEvent.click(screen.getByText("Results table on graph"));
    fireEvent.click(screen.getByLabelText("R²"));
    fireEvent.click(screen.getByLabelText("χ² (sum of squares)"));
    fireEvent.click(screen.getByRole("button", { name: "Add results table to graph" }));
    const labels = (useApp.getState().layers[0] as { rows: string[][] }).rows.map((r) => r[0]);
    expect(labels).toEqual(["Parameter", "A", "tau", "Reduced χ²", "χ²"]);
  });

  it("Update table rewrites that table from the new fit as one undo step; Add stays a new table", () => {
    const first = mount(0.5);
    fireEvent.click(screen.getByText("Results table on graph"));
    fireEvent.click(screen.getByRole("button", { name: "Add results table to graph" }));
    first.unmount();
    mount(0.75); // a re-fit: new result, the panel re-mounts
    fireEvent.click(screen.getByText("Results table on graph"));
    const before = useApp.getState().history.length;
    fireEvent.click(screen.getByRole("button", { name: "Update table" }));
    expect(useApp.getState().layers).toHaveLength(1);
    expect((useApp.getState().layers[0] as { rows: string[][] }).rows[2]).toEqual(["tau", "0.750 ± 0.010"]);
    expect(useApp.getState().history.length).toBe(before + 1);
    useApp.getState().undo();
    expect((useApp.getState().layers[0] as { rows: string[][] }).rows[2]).toEqual(["tau", "0.500 ± 0.010"]);
  });

  it("refuses to overwrite a table the user edited (M6)", () => {
    const first = mount(0.5);
    fireEvent.click(screen.getByText("Results table on graph"));
    fireEvent.click(screen.getByRole("button", { name: "Add results table to graph" }));
    const [layer] = useApp.getState().layers;
    useApp.setState({ layers: [{ ...layer!, rows: [["My note", "edited"]] } as typeof layer & object] });
    first.unmount();
    mount(0.75);
    fireEvent.click(screen.getByText("Results table on graph"));
    fireEvent.click(screen.getByRole("button", { name: "Update table" }));
    expect((useApp.getState().layers[0] as { rows: string[][] }).rows).toEqual([["My note", "edited"]]);
    expect(useApp.getState().status).toContain("was edited");
  });

  it("does not offer Update in another window that carries a copy of the layer id (M6)", () => {
    useApp.setState({ focusedWindowId: "w1" });
    const first = mount(0.5);
    fireEvent.click(screen.getByText("Results table on graph"));
    fireEvent.click(screen.getByRole("button", { name: "Add results table to graph" }));
    first.unmount();
    useApp.setState({ focusedWindowId: "w2" }); // a duplicated window shares the layer id
    mount(0.75);
    fireEvent.click(screen.getByText("Results table on graph"));
    expect(screen.queryByRole("button", { name: "Update table" })).toBeNull();
  });
});
