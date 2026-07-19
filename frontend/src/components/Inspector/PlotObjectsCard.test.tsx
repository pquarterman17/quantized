import { fireEvent, render, screen } from "@testing-library/react";
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
});
