// SelectionMiniToolbar — the GUI_INTERACTION #8 residual's fourth registry
// consumer. Same render/store-seed convention as ToolHud.test.tsx.

import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useApp } from "../../store/useApp";
import SelectionMiniToolbar from "./SelectionMiniToolbar";

beforeEach(() => {
  useApp.setState({
    plotTool: "pointer",
    annotations: [],
    selectedAnnotationId: null,
    shapes: [],
    selectedShapeId: null,
  });
});

describe("SelectionMiniToolbar", () => {
  it("renders nothing with no selection", () => {
    const { container } = render(<SelectionMiniToolbar />);
    expect(container.querySelector(".qzk-mini-toolbar")).toBeNull();
  });

  it("renders nothing when plotTool isn't pointer, even with a live selection", () => {
    useApp.setState({
      plotTool: "zoom",
      annotations: [{ id: "a1", x: 1, y: 2, text: "Tc" }],
      selectedAnnotationId: "a1",
    });
    const { container } = render(<SelectionMiniToolbar />);
    expect(container.querySelector(".qzk-mini-toolbar")).toBeNull();
  });

  it("renders the annotation actions for a selected annotation, no pin toggle (conv null)", () => {
    useApp.setState({
      annotations: [{ id: "a1", x: 1, y: 2, text: "Tc" }],
      selectedAnnotationId: "a1",
    });
    const { container, getByText, queryByText } = render(<SelectionMiniToolbar />);
    expect(container.querySelector(".qzk-mini-toolbar")).not.toBeNull();
    expect(getByText("Edit text…")).toBeTruthy();
    expect(getByText("Size +")).toBeTruthy();
    expect(getByText("Size −")).toBeTruthy();
    expect(getByText("Delete")).toBeTruthy();
    expect(queryByText(/^Pin to/)).toBeNull();
  });

  it("clicking Delete removes the selected annotation from the store", () => {
    useApp.setState({
      annotations: [{ id: "a1", x: 1, y: 2, text: "Tc" }],
      selectedAnnotationId: "a1",
    });
    const { getByText } = render(<SelectionMiniToolbar />);
    fireEvent.click(getByText("Delete"));
    expect(useApp.getState().annotations).toEqual([]);
    expect(useApp.getState().selectedAnnotationId).toBeNull();
  });

  it("renders the shape actions for a selected shape (no annotation selected)", () => {
    useApp.setState({
      shapes: [{ id: "s1", kind: "rect", x1: 1, y1: 2, x2: 3, y2: 4 }],
      selectedShapeId: "s1",
    });
    const { getByText } = render(<SelectionMiniToolbar />);
    expect(getByText("Dashed")).toBeTruthy();
    expect(getByText("Delete")).toBeTruthy();
  });

  it("clicking Dashed toggles the shape's dash flag", () => {
    useApp.setState({
      shapes: [{ id: "s1", kind: "rect", x1: 1, y1: 2, x2: 3, y2: 4 }],
      selectedShapeId: "s1",
    });
    const { getByText } = render(<SelectionMiniToolbar />);
    fireEvent.click(getByText("Dashed"));
    expect(useApp.getState().shapes[0].dash).toBe(true);
  });

  it("prefers the annotation over a shape when both happen to be selected", () => {
    useApp.setState({
      annotations: [{ id: "a1", x: 1, y: 2, text: "Tc" }],
      selectedAnnotationId: "a1",
      shapes: [{ id: "s1", kind: "rect", x1: 1, y1: 2, x2: 3, y2: 4 }],
      selectedShapeId: "s1",
    });
    const { queryByText } = render(<SelectionMiniToolbar />);
    expect(queryByText("Dashed")).toBeNull();
    expect(queryByText("Edit text…")).toBeTruthy();
  });
});
