import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useApp } from "../../store/useApp";
import PlotObjectsCard from "./PlotObjectsCard";

beforeEach(() => {
  useApp.setState({
    datasets: [{
      id: "d1",
      name: "scan",
      data: { time: [0, 1], values: [[1, 2], [3, 4]], labels: ["A", "B"], units: ["", ""], metadata: {} },
    }],
    activeId: "d1",
    xKey: null,
    yKeys: [0, 1],
    y2Keys: null,
    seriesOrder: null,
    hiddenChannels: [],
    annotations: [{ id: "a1", x: 0, y: 1, text: "peak" }],
    shapes: [{ id: "s1", kind: "line", x1: 0, y1: 0, x2: 1, y2: 1, anchor: "data" }],
    selectedAnnotationId: null,
    selectedShapeId: null,
    history: [],
    future: [],
  });
});

describe("PlotObjectsCard", () => {
  it("controls curve visibility, order, and Y-axis assignment", () => {
    render(<PlotObjectsCard />);
    fireEvent.click(screen.getByText("Plot objects"));

    fireEvent.click(screen.getByRole("button", { name: "Hide A" }));
    expect(useApp.getState().hiddenChannels).toEqual([0]);
    fireEvent.click(screen.getAllByTitle("Move down")[0]);
    expect(useApp.getState().seriesOrder).toEqual([1, 0]);
    fireEvent.click(screen.getAllByText("Y")[0]);
    expect(useApp.getState().y2Keys).toEqual([1]);
  });

  it("synchronizes graphic-object selection and exposes duplicate/delete", () => {
    render(<PlotObjectsCard />);
    fireEvent.click(screen.getByText("Plot objects"));

    fireEvent.click(screen.getByRole("button", { name: "peak" }));
    expect(useApp.getState().selectedAnnotationId).toBe("a1");
    fireEvent.click(screen.getByRole("button", { name: "line" }));
    expect(useApp.getState().selectedAnnotationId).toBeNull();
    expect(useApp.getState().selectedShapeId).toBe("s1");

    fireEvent.click(screen.getAllByTitle("Duplicate")[1]);
    expect(useApp.getState().shapes).toHaveLength(2);
    fireEvent.click(screen.getAllByTitle("Delete")[1]);
    expect(useApp.getState().shapes).toHaveLength(1);
  });

  it("aligns, groups, and styles a multi-selection as named undo steps", () => {
    useApp.setState({
      annotations: [{ id: "a1", x: 0, y: 1, text: "peak" }],
      shapes: [{ id: "s1", kind: "line", x1: 2, y1: 0, x2: 3, y2: 1 }],
    });
    render(<PlotObjectsCard />);
    fireEvent.click(screen.getByText("Plot objects"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select annotation peak" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select line shape" }));

    fireEvent.click(screen.getByRole("button", { name: "Left" }));
    expect(useApp.getState().shapes[0]).toMatchObject({ x1: 0, x2: 1 });
    expect(useApp.getState().history.at(-1)?.label).toBe("align plot objects");

    fireEvent.click(screen.getByRole("button", { name: "Group" }));
    const { annotations, shapes } = useApp.getState();
    expect(annotations[0].groupId).toBeTruthy();
    expect(shapes[0].groupId).toBe(annotations[0].groupId);

    fireEvent.change(screen.getByLabelText("Shared color"), { target: { value: "#ff0000" } });
    fireEvent.change(screen.getByLabelText("Shared opacity"), { target: { value: "0.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    // #66 fix: a frameless annotation is NOT given a text box by "shared style"
    // (recolor existing geometry, never add new). Only the shape recolors.
    expect(useApp.getState().annotations[0].frame).toBeUndefined();
    expect(useApp.getState().shapes[0]).toMatchObject({ stroke: "#ff0000", opacity: 0.5 });

    useApp.getState().undo();
    expect(useApp.getState().shapes[0].stroke).toBeUndefined();
    expect(useApp.getState().annotations[0].groupId).toBeTruthy();
  });

  it("recolors an annotation that ALREADY has a frame (shared style)", () => {
    useApp.setState({
      annotations: [{ id: "a1", x: 0, y: 1, text: "peak", frame: { stroke: "#000", opacity: 1 } }],
      shapes: [],
    });
    render(<PlotObjectsCard />);
    fireEvent.click(screen.getByText("Plot objects"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select annotation peak" }));
    fireEvent.change(screen.getByLabelText("Shared color"), { target: { value: "#00ff00" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(useApp.getState().annotations[0].frame).toMatchObject({ stroke: "#00ff00" });
  });

  it("a multi-selection survives a bulk edit even with a canvas anchor set", () => {
    // Regression for the collapse bug: the sync effect used to re-fire on the
    // annotations/shapes array change caused by a bulk edit and reset the
    // working set to just the canvas-selected object, silently dropping the
    // other member from the NEXT bulk command.
    useApp.setState({
      annotations: [{ id: "a1", x: 0, y: 5, text: "peak" }],
      shapes: [{ id: "s1", kind: "line", x1: 2, y1: 0, x2: 3, y2: 1 }],
      selectedAnnotationId: "a1", // a canvas anchor exists
      selectedShapeId: null,
    });
    render(<PlotObjectsCard />);
    fireEvent.click(screen.getByText("Plot objects"));
    // The canvas anchor a1 is already selected on mount; ADD the shape to make
    // a 2-object working set (the real scenario the bug hit).
    expect(screen.getByRole("checkbox", { name: "Select annotation peak" })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select line shape" }));

    // First bulk command (mutates the arrays → old code collapsed the
    // selection to just the canvas anchor a1 right here).
    fireEvent.click(screen.getByRole("button", { name: "Left" }));
    // The working set must SURVIVE — both checkboxes still checked. With the
    // old bug, the shape's checkbox would be cleared (selection = {a1} only).
    expect(screen.getByRole("checkbox", { name: "Select annotation peak" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select line shape" })).toBeChecked();
    // And a second bulk command still records a step (still has ≥2 objects).
    fireEvent.click(screen.getByRole("button", { name: "Top" }));
    expect(useApp.getState().history.at(-1)?.label).toBe("align plot objects");
  });

  it("selecting one grouped object from the canvas selects its whole group", async () => {
    useApp.setState({
      annotations: [{ id: "a1", groupId: "g1", x: 0, y: 1, text: "peak" }],
      shapes: [{ id: "s1", groupId: "g1", kind: "line", x1: 0, y1: 0, x2: 1, y2: 1 }],
    });
    render(<PlotObjectsCard />);
    fireEvent.click(screen.getByText("Plot objects"));
    act(() => useApp.getState().setSelectedShapeId("s1"));
    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "Select annotation peak" })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: "Select line shape" })).toBeChecked();
    });
  });
});
