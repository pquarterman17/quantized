// GUI_INTERACTION #3 sub-item 4: a drawn shape's x1/y1 → x2/y2 fields are
// the non-mouse "move/reshape this shape" path — until this landed, a shape
// had no way to reposition it except dragging its body/handle on the canvas.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import ShapesCard from "./ShapesCard";
import { useApp } from "../../store/useApp";

beforeEach(() => {
  useApp.setState({
    shapes: [{ id: "s1", kind: "rect", x1: 1, y1: 2, x2: 3, y2: 4 }],
    selectedShapeId: null,
  });
});

describe("ShapesCard — editable x1/y1 → x2/y2", () => {
  it("shows the shape's current coordinates in editable fields", () => {
    render(<ShapesCard />);
    expect(screen.getByDisplayValue("1")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2")).toBeInTheDocument();
    expect(screen.getByDisplayValue("3")).toBeInTheDocument();
    expect(screen.getByDisplayValue("4")).toBeInTheDocument();
  });

  it("typing a new x2 commits it via updateShape", () => {
    render(<ShapesCard />);
    fireEvent.change(screen.getByPlaceholderText("x2"), { target: { value: "10" } });
    expect(useApp.getState().shapes[0].x2).toBe(10);
  });

  it("typing a new y1 commits it via updateShape", () => {
    render(<ShapesCard />);
    fireEvent.change(screen.getByPlaceholderText("y1"), { target: { value: "-3" } });
    expect(useApp.getState().shapes[0].y1).toBe(-3);
  });

  it("clicking the kind label still toggles selection (unaffected by the new fields)", () => {
    render(<ShapesCard />);
    fireEvent.click(screen.getByText("rect"));
    expect(useApp.getState().selectedShapeId).toBe("s1");
  });

  it("Remove still works from the reflowed row", () => {
    render(<ShapesCard />);
    fireEvent.click(screen.getByTitle("Remove"));
    expect(useApp.getState().shapes).toHaveLength(0);
  });
});
