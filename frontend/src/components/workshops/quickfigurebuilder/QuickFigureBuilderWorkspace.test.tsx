import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import QuickFigureBuilderWorkspace from "./QuickFigureBuilderWorkspace";

const dataset: Dataset = {
  id: "d1",
  name: "measurement.csv",
  data: {
    time: [0, 1, 2],
    values: [[2, 3], [4, 5], [6, 7]],
    labels: ["signal", "error"],
    units: ["V", "V"],
    metadata: {},
  },
};

beforeEach(() => {
  useApp.setState({
    datasets: [dataset],
    quickFigureBuilderDatasetId: "d1",
    editableFigures: [],
    plotWindows: [],
    cmdkOpen: false,
  });
});

describe("QuickFigureBuilderWorkspace — G1 shell", () => {
  it("shows the source facts without creating or mutating a figure", () => {
    render(<QuickFigureBuilderWorkspace />);
    expect(screen.getByRole("heading", { name: "Configure measurement.csv" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Role for signal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Editable Figure" })).toBeDisabled();
    expect(useApp.getState().editableFigures).toEqual([]);
  });

  it("offers keyboard-accessible X, Y, ignore, and targeted error roles", () => {
    render(<QuickFigureBuilderWorkspace />);
    const signal = screen.getByRole("combobox", { name: "Role for signal" });
    const error = screen.getByRole("combobox", { name: "Role for error" });
    expect(signal).toHaveValue("y");
    fireEvent.change(signal, { target: { value: "x" } });
    expect(signal).toHaveValue("x");
    fireEvent.change(error, { target: { value: "error:x:-1:both" } });
    expect(error).toHaveValue("error:x:-1:both");
    fireEvent.change(error, { target: { value: "y" } });
    expect(screen.getByText("1 Y series against signal. Live rendering arrives in G3.")).toBeInTheDocument();
  });

  it("supports dragging a column into an explicit role zone", () => {
    render(<QuickFigureBuilderWorkspace />);
    const values = new Map<string, string>();
    const dataTransfer = {
      setData: (type: string, value: string) => values.set(type, value),
      getData: (type: string) => values.get(type) ?? "",
    };
    const row = screen.getByText("signal").closest("li")!;
    const ignoreZone = screen.getByLabelText("Column role drop zones").querySelectorAll(".qzk-quick-builder-zone")[2];
    fireEvent.dragStart(row, { dataTransfer });
    fireEvent.drop(ignoreZone, { dataTransfer });
    expect(screen.getByRole("combobox", { name: "Role for signal" })).toHaveValue("ignore");
  });

  it("Cancel clears only the transient builder target", () => {
    const datasetsBefore = useApp.getState().datasets;
    render(<QuickFigureBuilderWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useApp.getState().quickFigureBuilderDatasetId).toBeNull();
    expect(useApp.getState().datasets).toBe(datasetsBefore);
    expect(useApp.getState().editableFigures).toEqual([]);
  });

  it("Escape cancels, but the command palette owns Escape while open", () => {
    render(<QuickFigureBuilderWorkspace />);
    useApp.setState({ cmdkOpen: true });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useApp.getState().quickFigureBuilderDatasetId).toBe("d1");
    useApp.setState({ cmdkOpen: false });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useApp.getState().quickFigureBuilderDatasetId).toBeNull();
  });

  it("degrades honestly if the source disappears while open", () => {
    useApp.setState({ datasets: [] });
    render(<QuickFigureBuilderWorkspace />);
    expect(screen.getByRole("heading", { name: "Worksheet unavailable" })).toBeInTheDocument();
    expect(screen.getByText("The source worksheet was removed. Nothing was changed.")).toBeInTheDocument();
  });
});
