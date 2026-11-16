// Legend formatting dialog (audit 6 lane M): entries, corner, visibility, one
// undo step per Apply, and the Reset position that the legend's double-click
// used to do directly.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../../../lib/types";
import { openFigureDialog, useFigureDialog } from "../../../store/figureDialogs";
import { useApp } from "../../../store/useApp";
import FigureDialogs from "./FigureDialogs";

const ds: Dataset = {
  id: "d", name: "M(H)",
  data: { time: [0, 1], values: [[1, 2], [3, 4]], labels: ["a", "b"], units: ["V", ""], metadata: {} },
};
const st = () => useApp.getState();

beforeEach(() => {
  useFigureDialog.setState({ open: null });
  useApp.setState({
    datasets: [ds], activeId: "d", yKeys: null, xKey: null, seriesLabels: {}, showLegend: true,
    legendPos: "sw", legendXY: null, legendFrameXY: null, history: [], future: [],
  });
});

const open = () => {
  openFigureDialog({ kind: "legend" });
  render(<FigureDialogs />);
};

describe("Legend dialog", () => {
  it("renames an entry through the store label the export reads", () => {
    open();
    expect(screen.getByRole("dialog", { name: "Legend" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Legend entry for a (V)"), { target: { value: "Moment" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(st().seriesLabels).toEqual({ 0: "Moment" });
    expect(useFigureDialog.getState().open).toBeNull();
  });

  it("the entry placeholder is the legend row's own text, unit included", () => {
    open();
    expect(screen.getByLabelText("Legend entry for a (V)")).toHaveAttribute("placeholder", "a (V)");
    expect(screen.getByLabelText("Legend entry for b")).toHaveAttribute("placeholder", "b");
  });

  it("hides the legend", () => {
    open();
    fireEvent.click(screen.getByRole("checkbox", { name: "Show legend" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(st().showLegend).toBe(false);
  });

  it("picks a corner", () => {
    open();
    fireEvent.change(screen.getByLabelText("Legend position"), { target: { value: "nw" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(st().legendPos).toBe("nw");
  });

  it("a corner picked while the legend is dragged clears the free position, so it really moves", () => {
    useApp.setState({ legendXY: [0.5, 0.5], legendPos: "sw" });
    open();
    fireEvent.change(screen.getByLabelText("Legend position"), { target: { value: "se" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(st().legendPos).toBe("se");
    expect(st().legendXY).toBeNull();
  });

  it("a corner picked while frame-anchored clears the frame anchor too", () => {
    useApp.setState({ legendFrameXY: [0.2, 0.8], legendPos: "sw" });
    open();
    fireEvent.change(screen.getByLabelText("Legend position"), { target: { value: "ne" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(st().legendFrameXY).toBeNull();
    expect(st().legendPos).toBe("ne");
  });

  it("leaves a dragged legend where it is when the corner is not changed", () => {
    useApp.setState({ legendXY: [0.5, 0.5] });
    open();
    fireEvent.change(screen.getByLabelText("Legend entry for a (V)"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(st().legendXY).toEqual([0.5, 0.5]);
  });

  it("one Apply is ONE undo step, however many things it changed", () => {
    open();
    fireEvent.click(screen.getByRole("checkbox", { name: "Show legend" }));
    fireEvent.change(screen.getByLabelText("Legend position"), { target: { value: "nw" } });
    fireEvent.change(screen.getByLabelText("Legend entry for a (V)"), { target: { value: "A" } });
    fireEvent.change(screen.getByLabelText("Legend entry for b"), { target: { value: "B" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(st().history).toHaveLength(1);
    st().undo();
    expect(st().showLegend).toBe(true);
    expect(st().legendPos).toBe("sw");
    expect(st().seriesLabels).toEqual({});
  });

  it("Cancel changes nothing", () => {
    open();
    fireEvent.change(screen.getByLabelText("Legend entry for a (V)"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(st().seriesLabels).toEqual({});
    expect(st().history).toHaveLength(0);
  });

  it("Reset position snaps a dragged legend to the nearest corner and clears the free position", () => {
    useApp.setState({ legendXY: [0.9, 0.1], legendPos: "sw" });
    open();
    fireEvent.click(screen.getByRole("button", { name: "Reset position" }));
    expect(st().legendXY).toBeNull();
    expect(st().legendPos).toBe("ne");
    expect(st().history).toHaveLength(1);
  });

  it("Reset position clears a frame anchor, falling back to the pinned corner", () => {
    useApp.setState({ legendFrameXY: [0.2, 0.8], legendXY: null, legendPos: "sw" });
    open();
    fireEvent.click(screen.getByRole("button", { name: "Reset position" }));
    expect(st().legendFrameXY).toBeNull();
    expect(st().legendPos).toBe("sw");
  });

  it("Reset position is disabled when the legend sits in a corner already", () => {
    open();
    expect(screen.getByRole("button", { name: "Reset position" })).toBeDisabled();
  });
});
