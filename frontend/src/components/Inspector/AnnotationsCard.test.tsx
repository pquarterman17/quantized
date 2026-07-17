// GUI_INTERACTION #3 sub-item 4: an existing annotation's X/Y fields are the
// non-mouse "move this annotation" path — until this landed, repositioning
// one after creation was drag-only on the canvas. This covers only the new
// per-row editable fields (the add-new-annotation form is pre-existing).

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import AnnotationsCard from "./AnnotationsCard";
import { useApp } from "../../store/useApp";

beforeEach(() => {
  useApp.setState({ annotations: [{ id: "a1", x: 1, y: 2, text: "peak" }] });
});

describe("AnnotationsCard — editable X/Y on an existing annotation", () => {
  it("shows the current x/y in editable fields, not read-only text", () => {
    render(<AnnotationsCard />);
    expect(screen.getByDisplayValue("1")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2")).toBeInTheDocument();
  });

  it("typing a new X commits it via updateAnnotation", () => {
    render(<AnnotationsCard />);
    // Index 1: the always-present "add annotation" form's own X field is
    // index 0; the existing annotation's field follows it.
    fireEvent.change(screen.getAllByPlaceholderText("X")[1], { target: { value: "5" } });
    expect(useApp.getState().annotations[0].x).toBe(5);
  });

  it("typing a new Y commits it via updateAnnotation", () => {
    render(<AnnotationsCard />);
    fireEvent.change(screen.getAllByPlaceholderText("Y")[1], { target: { value: "9" } });
    expect(useApp.getState().annotations[0].y).toBe(9);
  });

  it("an incomplete number (e.g. a bare minus sign) doesn't commit", () => {
    render(<AnnotationsCard />);
    fireEvent.change(screen.getAllByPlaceholderText("X")[1], { target: { value: "-" } });
    expect(useApp.getState().annotations[0].x).toBe(1); // unchanged
  });
});
