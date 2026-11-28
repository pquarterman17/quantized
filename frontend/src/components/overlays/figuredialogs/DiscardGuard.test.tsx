// E6 (plan item 50): an outside click on an EDITED figure popup asks before it
// throws the draft away. Driven through real popups opened with
// openFigureDialog, as the right-click menu does.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { defaultPlotView } from "../../../lib/plotview";
import type { Dataset } from "../../../lib/types";
import { openFigureDialog, useFigureDialog } from "../../../store/figureDialogs";
import { useApp } from "../../../store/useApp";
import FigureDialogs from "./FigureDialogs";

const ds: Dataset = {
  id: "d", name: "M(H)",
  data: { time: [0, 1], values: [[1, 2], [3, 4]], labels: ["a", "b"], units: ["", ""], metadata: {} },
};
const st = () => useApp.getState();

beforeEach(() => {
  useFigureDialog.setState({ open: null });
  useApp.setState({
    ...defaultPlotView(), datasets: [ds], activeId: "d", seriesLabels: {}, showLegend: true,
    legendPos: "sw", legendXY: null, legendFrameXY: null, history: [], future: [],
  });
});

const backdrop = () => document.querySelector(".qz-overlay-backdrop") as HTMLElement;
const entry = () => screen.getByLabelText("Legend entry for a") as HTMLInputElement;
const question = () => screen.queryByRole("group", { name: "Discard your changes?" });

function openLegend() {
  openFigureDialog({ kind: "legend" });
  render(<FigureDialogs />);
}

describe("E6: outside click on a popup", () => {
  it("edited: asks, and the popup stays open", () => {
    openLegend();
    fireEvent.change(entry(), { target: { value: "Moment" } });
    fireEvent.mouseDown(backdrop());
    expect(question()).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Legend" })).toBeInTheDocument();
    expect(useFigureDialog.getState().open).not.toBeNull();
  });

  it("Keep editing returns to the popup with the draft intact", () => {
    openLegend();
    fireEvent.change(entry(), { target: { value: "Moment" } });
    fireEvent.mouseDown(backdrop());
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(question()).toBeNull();
    expect(entry().value).toBe("Moment");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(st().seriesLabels).toEqual({ 0: "Moment" });
  });

  it("Discard closes the popup and leaves the store unchanged", () => {
    openLegend();
    fireEvent.change(entry(), { target: { value: "Moment" } });
    fireEvent.mouseDown(backdrop());
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(useFigureDialog.getState().open).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(st().seriesLabels).toEqual({});
    expect(st().history).toHaveLength(0);
  });

  it("unedited: closes at once, without asking", () => {
    openLegend();
    fireEvent.mouseDown(backdrop());
    expect(question()).toBeNull();
    expect(useFigureDialog.getState().open).toBeNull();
  });

  it("a checkbox change counts as an edit", () => {
    openLegend();
    fireEvent.click(screen.getByRole("checkbox", { name: "Show legend" }));
    fireEvent.mouseDown(backdrop());
    expect(question()).toBeInTheDocument();
  });

  it("a mousedown inside the popup never asks or closes", () => {
    openLegend();
    fireEvent.change(entry(), { target: { value: "x" } });
    fireEvent.mouseDown(screen.getByRole("dialog", { name: "Legend" }));
    expect(question()).toBeNull();
    expect(screen.getByRole("dialog", { name: "Legend" })).toBeInTheDocument();
  });

  it("edited, then Esc: closes without asking", async () => {
    openLegend();
    fireEvent.change(entry(), { target: { value: "Moment" } });
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(useFigureDialog.getState().open).toBeNull());
    expect(question()).toBeNull();
    expect(st().seriesLabels).toEqual({});
  });

  it("Esc on the question answers the question: the popup stays", async () => {
    openLegend();
    fireEvent.change(entry(), { target: { value: "Moment" } });
    fireEvent.mouseDown(backdrop());
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(question()).toBeNull());
    expect(screen.getByRole("dialog", { name: "Legend" })).toBeInTheDocument();
    expect(entry().value).toBe("Moment");
  });

  it("a replaced popup starts unedited", () => {
    openLegend();
    fireEvent.change(entry(), { target: { value: "Moment" } });
    // another command opens a different popup over the edited one
    act(() => openFigureDialog({ kind: "legend" }));
    fireEvent.mouseDown(backdrop());
    expect(question()).toBeNull();
    expect(useFigureDialog.getState().open).toBeNull();
  });

  it("applies to the Axis popup too, with no per-dialog wiring", () => {
    openFigureDialog({ kind: "axis", axis: "x" });
    render(<FigureDialogs />);
    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "5" } });
    fireEvent.mouseDown(backdrop());
    expect(question()).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(useFigureDialog.getState().open).toBeNull();
    expect(st().history).toHaveLength(0);
  });
});
