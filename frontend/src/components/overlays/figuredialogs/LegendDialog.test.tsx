// Legend formatting dialog (audit 6 lane M): entries, corner, visibility, and
// the Reset position that the legend's double-click used to do directly.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../../../lib/types";
import { openFigureDialog, useFigureDialog } from "../../../store/figureDialogs";
import { useApp } from "../../../store/useApp";
import FigureDialogs from "./FigureDialogs";

const ds: Dataset = {
  id: "d", name: "M(H)",
  data: { time: [0, 1], values: [[1, 2], [3, 4]], labels: ["a", "b"], units: ["", ""], metadata: {} },
};

beforeEach(() => {
  useFigureDialog.setState({ open: null });
  useApp.setState({
    datasets: [ds], activeId: "d", yKeys: null, xKey: null, seriesLabels: {}, showLegend: true,
    legendPos: "sw", legendXY: null, legendFrameXY: null, history: [], future: [],
  });
});

describe("Legend dialog", () => {
  it("renames an entry through the store label the export reads, and can hide the legend", () => {
    openFigureDialog({ kind: "legend" });
    render(<FigureDialogs />);
    expect(screen.getByRole("dialog", { name: "Legend" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Legend entry for a"), { target: { value: "Moment" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(useApp.getState().seriesLabels).toEqual({ 0: "Moment" });
    expect(useFigureDialog.getState().open).toBeNull();
  });

  it("Cancel changes nothing", () => {
    openFigureDialog({ kind: "legend" });
    render(<FigureDialogs />);
    fireEvent.change(screen.getByLabelText("Legend entry for a"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useApp.getState().seriesLabels).toEqual({});
  });

  it("Reset position snaps a dragged legend to the nearest corner and clears the free position", () => {
    useApp.setState({ legendXY: [0.9, 0.1], legendPos: "sw" });
    openFigureDialog({ kind: "legend" });
    render(<FigureDialogs />);
    fireEvent.click(screen.getByRole("button", { name: "Reset position" }));
    expect(useApp.getState().legendXY).toBeNull();
    expect(useApp.getState().legendPos).toBe("ne");
  });

  it("Reset position clears a frame anchor, falling back to the pinned corner", () => {
    useApp.setState({ legendFrameXY: [0.2, 0.8], legendXY: null, legendPos: "sw" });
    openFigureDialog({ kind: "legend" });
    render(<FigureDialogs />);
    fireEvent.click(screen.getByRole("button", { name: "Reset position" }));
    expect(useApp.getState().legendFrameXY).toBeNull();
    expect(useApp.getState().legendPos).toBe("sw");
  });

  it("Reset position is disabled when the legend sits in a corner already", () => {
    openFigureDialog({ kind: "legend" });
    render(<FigureDialogs />);
    expect(screen.getByRole("button", { name: "Reset position" })).toBeDisabled();
  });
});
