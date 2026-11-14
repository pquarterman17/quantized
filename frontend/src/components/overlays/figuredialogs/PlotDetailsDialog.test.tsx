// Gap audit 2 #8: Plot Details for one curve, inside the lazy FigureDialogs
// host — a draft committed as ONE undo step on Apply, nothing on Cancel.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import FigureDialogs from "./FigureDialogs";
import { defaultPlotView } from "../../../lib/plotview";
import type { Dataset } from "../../../lib/types";
import { openFigureDialog, useFigureDialog } from "../../../store/figureDialogs";
import { useApp } from "../../../store/useApp";

const ds: Dataset = {
  id: "d", name: "d.csv",
  data: { time: [0, 1, 2], values: [[1, 5], [2, 6], [3, 7]], labels: ["A", "B"], units: ["", ""], metadata: {} },
};

beforeEach(() => {
  useFigureDialog.setState({ open: null });
  useApp.setState({ ...defaultPlotView(), datasets: [ds], activeId: "d", history: [], future: [], seriesStyles: { 1: { width: 2 } } });
});

describe("Plot Details (#8)", () => {
  it("edits colour, line, symbol and error bars, and Apply commits one undo step", () => {
    openFigureDialog({ kind: "plotDetails", channel: 1 });
    render(<FigureDialogs />);
    expect(screen.getByRole("dialog", { name: "Plot Details" })).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument(); // the curve it edits
    fireEvent.click(screen.getByRole("button", { name: "Black" }));
    fireEvent.change(screen.getByLabelText("Line style"), { target: { value: "dashed" } });
    fireEvent.click(screen.getByText("Show symbols"));
    fireEvent.change(screen.getByLabelText("Symbol shape"), { target: { value: "square" } });
    fireEvent.click(screen.getByRole("radio", { name: "Open symbol" }));
    fireEvent.change(screen.getByLabelText("Error bar cap size"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Error bar line width"), { target: { value: "2" } });
    // Nothing reaches the store before Apply.
    expect(useApp.getState().seriesStyles[1]).toEqual({ width: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(useApp.getState().seriesStyles[1]).toMatchObject({
      width: 2, color: "#000000", line: "dashed", marker: true, markerShape: "square", markerFill: "hollow",
      errorBar: { cap: 4, width: 2 },
    });
    expect(useApp.getState().history).toHaveLength(1);
    expect(useFigureDialog.getState().open).toBeNull();
  });

  it("Cancel leaves the curve untouched", () => {
    openFigureDialog({ kind: "plotDetails", channel: 1 });
    render(<FigureDialogs />);
    fireEvent.click(screen.getByRole("button", { name: "Black" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useApp.getState().seriesStyles[1]).toEqual({ width: 2 });
    expect(useApp.getState().history).toHaveLength(0);
  });
});
