import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import PreviewOverlay from "./PreviewOverlay";
import type { FigureHitmap } from "../../../lib/previewmap";

const MAP: FigureHitmap = {
  image: "",
  width: 600,
  height: 400,
  elements: [
    { id: "title", x0: 250, y0: 10, x1: 350, y1: 30 },
    { id: "legend", x0: 450, y0: 60, x1: 560, y1: 120 },
    { id: "ann:0", x0: 200, y0: 200, x1: 240, y1: 216 },
  ],
  axes: {
    x0: 60,
    y0: 40,
    x1: 580,
    y1: 360,
    xlim: [0, 10],
    ylim: [0, 100],
    xlog: false,
    ylog: false,
  },
};

const setup = () => {
  const onSelect = vi.fn();
  const onEditText = vi.fn();
  const onDragEnd = vi.fn();
  render(
    <PreviewOverlay
      src="data:image/png;base64,"
      map={MAP}
      textOf={(id) => (id === "title" ? "Old title" : "")}
      onSelect={onSelect}
      onEditText={onEditText}
      onDragEnd={onDragEnd}
    />,
  );
  return { onSelect, onEditText, onDragEnd };
};

const el = (id: string) => document.querySelector(`[data-element="${id}"]`)!;

describe("PreviewOverlay", () => {
  it("click selects an element (#13)", () => {
    const { onSelect } = setup();
    fireEvent.click(el("legend"));
    expect(onSelect).toHaveBeenCalledWith("legend");
  });

  it("double-click on a text element opens the inline editor and commits (#14)", () => {
    const { onEditText } = setup();
    fireEvent.doubleClick(el("title"));
    const input = screen.getByDisplayValue("Old title");
    fireEvent.change(input, { target: { value: "New title" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onEditText).toHaveBeenCalledWith("title", "New title");
  });

  it("escape cancels the inline edit without committing", () => {
    const { onEditText } = setup();
    fireEvent.doubleClick(el("title"));
    fireEvent.keyDown(screen.getByDisplayValue("Old title"), { key: "Escape" });
    expect(onEditText).not.toHaveBeenCalled();
  });

  it("dragging the legend reports the drop point; a 1px jiggle does not (#14)", () => {
    const { onDragEnd } = setup();
    const legend = el("legend");
    // jsdom has no layout — getBoundingClientRect is all zeros, so the drop
    // maps to [0,0]; the assertion is about the CALL semantics, not coords.
    fireEvent.pointerDown(legend, { clientX: 500, clientY: 90, pointerId: 1 });
    fireEvent.pointerMove(legend, { clientX: 520, clientY: 130, pointerId: 1 });
    fireEvent.pointerUp(legend, { clientX: 520, clientY: 130, pointerId: 1 });
    expect(onDragEnd).toHaveBeenCalledTimes(1);
    expect(onDragEnd.mock.calls[0][0]).toBe("legend");

    onDragEnd.mockClear();
    fireEvent.pointerDown(legend, { clientX: 500, clientY: 90, pointerId: 1 });
    fireEvent.pointerUp(legend, { clientX: 501, clientY: 90, pointerId: 1 });
    expect(onDragEnd).not.toHaveBeenCalled(); // click-sized movement = no drag
  });

  it("annotations are draggable, non-text elements have no inline editor", () => {
    const { onDragEnd, onEditText } = setup();
    const ann = el("ann:0");
    fireEvent.doubleClick(ann);
    expect(onEditText).not.toHaveBeenCalled();
    fireEvent.pointerDown(ann, { clientX: 210, clientY: 208, pointerId: 2 });
    fireEvent.pointerUp(ann, { clientX: 260, clientY: 250, pointerId: 2 });
    expect(onDragEnd).toHaveBeenCalledWith("ann:0", expect.any(Number), expect.any(Number));
  });
});
