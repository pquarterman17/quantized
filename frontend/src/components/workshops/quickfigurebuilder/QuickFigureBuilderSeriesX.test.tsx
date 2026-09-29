// Quick Figure Builder UI for per-series X (LIBRARY_WORKBOOK_UX_PLAN:
// `X, Y, X, Y, X, Y` / multiple independent X channels). The pure and store
// halves are pinned in lib/quickFigureSeriesX.test.ts and
// store/quickFigureSeriesX.test.ts; this covers the inferred pairing shown in
// the panel, reassigning one Y's X, and Create carrying it into the figure.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import QuickFigureBuilderWorkspace from "./QuickFigureBuilderWorkspace";

vi.mock("../../overlays/ParamDialog", () => ({ askParams: vi.fn() }));

// An Origin book laid out X,Y,X,Y,X,Y: A (X) is `.time`.
const dataset: Dataset = {
  id: "m1",
  name: "Moke.opj",
  data: {
    time: [0, 1, 2],
    values: [[1, 10, 100, 0, -1], [2, 20, 200, 2, 1], [3, 30, 300, 0, 2]],
    labels: ["Y1", "X2", "Y2", "X3", "Y3"],
    units: ["", "", "", "", ""],
    metadata: {
      x_column_name: "A",
      x_column_long: "X1",
      origin_column_names: ["B", "C", "D", "E", "F"],
      column_designations: { A: "X", B: "Y", C: "X", D: "Y", E: "X", F: "Y" },
    },
  },
};

beforeEach(() => {
  useApp.setState({
    datasets: [dataset],
    quickFigureBuilderDatasetId: "m1",
    editableFigures: [],
    plotWindows: [],
    quickPlotTemplates: [],
    cmdkOpen: false,
  });
});

const seriesX = (label: string) => screen.getByRole("combobox", { name: `X for ${label}` });

describe("QuickFigureBuilderWorkspace — per-series X", () => {
  it("shows each Y paired with its nearest-preceding X column, and the X columns' role", () => {
    render(<QuickFigureBuilderWorkspace />);
    expect(seriesX("Y1")).toHaveValue("shared");
    expect(seriesX("Y2")).toHaveValue("1");
    expect(seriesX("Y3")).toHaveValue("3");
    expect(screen.getByRole("combobox", { name: "Role for X2" })).toHaveValue("series-x");
    expect(screen.getByRole("option", { name: "X for Y3" })).toBeDisabled();
    expect(screen.getByText("3 Y series against their own X (3 X columns)")).toBeInTheDocument();
  });

  it("reassigning one Y's X updates the readout, and Create plots each series on its chosen X", () => {
    render(<QuickFigureBuilderWorkspace />);
    fireEvent.change(seriesX("Y3"), { target: { value: "1" } }); // Y3 onto X2 too
    expect(seriesX("Y3")).toHaveValue("1");
    expect(screen.getByRole("combobox", { name: "Role for X3" })).toHaveValue("unassigned");
    expect(screen.getByText("3 Y series against their own X (2 X columns)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create Editable Figure" }));
    const state = useApp.getState();
    const doc = state.editableFigures[0];
    const overlay = state.datasets.find((d) => d.id === doc.bindings.datasetId)!;
    expect(overlay.data.time).toEqual([0, 1, 2, 10, 20, 30]);
    expect(overlay.data.values.map((row) => row[2])).toEqual([NaN, NaN, NaN, -1, 1, 2]);
    expect(state.quickFigureBuilderDatasetId).toBeNull();
  });

  it("a CSV with no X designations starts shared-X; the user pairs each Y with its own X explicitly", () => {
    const { metadata, ...rest } = dataset.data;
    useApp.setState({ datasets: [{ ...dataset, id: "c1", name: "xyxy.csv", data: { ...rest, metadata: { x_column_long: metadata.x_column_long } } }], quickFigureBuilderDatasetId: "c1" });
    render(<QuickFigureBuilderWorkspace />);
    expect(screen.queryByRole("combobox", { name: "X for Y2" })).toBeNull(); // collapsed: never paired by adjacency
    fireEvent.click(screen.getByRole("button", { name: "Per-series X…" }));
    // X2/X3 import as Y series here; picking one as a series' X moves it out of Y.
    fireEvent.change(seriesX("Y2"), { target: { value: "1" } });
    fireEvent.change(seriesX("Y3"), { target: { value: "3" } });
    expect(screen.getByRole("combobox", { name: "Role for X2" })).toHaveValue("series-x");
    expect(screen.queryByRole("combobox", { name: "X for X2" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create Editable Figure" }));
    const overlay = useApp.getState().datasets.find((d) => d.id === useApp.getState().editableFigures[0].bindings.datasetId)!;
    expect(overlay.data.time).toEqual([0, 1, 2, 10, 20, 30, 0, 2, 0]);
    expect(overlay.data.labels).toEqual(["Y1", "Y2", "Y3"]);
  });

  it("names the acquisition axis by its own column name everywhere (GUI audit)", () => {
    render(<QuickFigureBuilderWorkspace />);
    const zones = screen.getByLabelText("Column role drop zones");
    expect(zones).toHaveTextContent("Shared X axisX1");
    // With a column as the shared X, the acquisition axis becomes a per-series option.
    fireEvent.change(screen.getByRole("combobox", { name: "Role for Y1" }), { target: { value: "x" } });
    expect(screen.getAllByRole("option", { name: "X1" })[0]).toHaveValue("acquisition");
    expect(screen.queryByText(/Acquisition axis/)).toBeNull();
  });

  it("back to Shared X for every series collapses to an ordinary shared-X figure on the source", () => {
    render(<QuickFigureBuilderWorkspace />);
    fireEvent.change(seriesX("Y2"), { target: { value: "shared" } });
    fireEvent.change(seriesX("Y3"), { target: { value: "shared" } });
    expect(screen.getByText("3 Y series against X1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create Editable Figure" }));
    expect(useApp.getState().editableFigures[0].bindings.datasetId).toBe("m1");
    expect(useApp.getState().datasets).toHaveLength(1);
  });
});
