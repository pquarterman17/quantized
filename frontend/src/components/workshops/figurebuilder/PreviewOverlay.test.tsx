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

const el = (id: string) => document.querySelector<HTMLElement>(`[data-element="${id}"]`)!;

describe("PreviewOverlay", () => {
  it("click selects an element (#13)", () => {
    const { onSelect } = setup();
    fireEvent.click(el("legend"));
    expect(onSelect).toHaveBeenCalledWith("legend");
  });

  it("right-click opens an element-aware menu without selecting", () => {
    const { onSelect } = setup();
    fireEvent.contextMenu(el("legend"), { clientX: 24, clientY: 36 });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByText("Legend")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Properties…" })).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("advertises the available preview interactions in hitbox titles", () => {
    setup();
    expect(el("title")).toHaveAttribute("title", "Title \u2014 double-click to edit; right-click for properties");
    expect(el("legend")).toHaveAttribute("title", "Legend \u2014 drag to move; right-click for properties");
    expect(el("ann:0")).toHaveAttribute("title", "Annotation \u2014 drag to move; right-click for properties");
  });

  it("Properties uses the same selection pathway as a click", () => {
    const { onSelect } = setup();
    fireEvent.contextMenu(el("legend"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Properties…" }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("legend");
  });

  it("offers text editing through the existing inline editor", () => {
    const { onEditText } = setup();
    fireEvent.contextMenu(el("title"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit text…" }));
    const input = screen.getByDisplayValue("Old title");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onEditText).toHaveBeenCalledExactlyOnceWith("title", "Old title");
  });

  it("keeps unavailable series properties visibly inert", () => {
    const seriesMap = { ...MAP, elements: [...MAP.elements, { id: "series:0", x0: 1, y0: 1, x1: 2, y1: 2 }] };
    const onSelect = vi.fn();
    render(
      <PreviewOverlay src="data:image/png;base64," map={seriesMap} textOf={() => ""} onSelect={onSelect} onEditText={vi.fn()} onDragEnd={vi.fn()} />,
    );
    fireEvent.contextMenu(el("series:0"));
    expect(screen.getByRole("menuitem", { name: "Series properties — edit on Stage" })).toBeDisabled();
    expect(el("series:0")).toHaveAttribute("title", "Series \u2014 properties are edited on Stage");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("puts the smaller legend hitbox above an overlapping series hitbox", () => {
    const overlapMap = {
      ...MAP,
      elements: [...MAP.elements, { id: "series:0", x0: 400, y0: 0, x1: 599, y1: 200 }],
    };
    render(
      <PreviewOverlay src="data:image/png;base64," map={overlapMap} textOf={() => ""} onSelect={vi.fn()} onEditText={vi.fn()} onDragEnd={vi.fn()} />,
    );
    expect(Number(el("legend").style.zIndex)).toBeGreaterThan(Number(el("series:0").style.zIndex));
    fireEvent.contextMenu(el("legend"));
    expect(screen.getByText("Legend")).toBeInTheDocument();
  });

  it("inherits ContextMenu keyboard navigation", () => {
    setup();
    fireEvent.contextMenu(el("title"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Properties…" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Edit text…" }));
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

  it("right-click during an in-progress drag clears the armed drag state", () => {
    const { onDragEnd } = setup();
    const legend = el("legend");
    fireEvent.pointerDown(legend, { clientX: 500, clientY: 90, pointerId: 1 });
    fireEvent.pointerMove(legend, { clientX: 520, clientY: 130, pointerId: 1 });
    fireEvent.contextMenu(legend, { clientX: 520, clientY: 130 });
    // A pointerUp after the context menu interrupted the drag must NOT report
    // a drop — the armed drag state was cleared, not carried through.
    fireEvent.pointerUp(legend, { clientX: 520, clientY: 130, pointerId: 1 });
    expect(onDragEnd).not.toHaveBeenCalled();
  });

  it("the inline text-edit input sits above every hitbox, including large series boxes (PR #116 regression)", () => {
    const bigMap: FigureHitmap = {
      ...MAP,
      elements: [
        ...MAP.elements,
        { id: "series:0", x0: 60, y0: 40, x1: 580, y1: 360 },
        { id: "series:1", x0: 60, y0: 40, x1: 580, y1: 200 },
      ],
    };
    render(
      <PreviewOverlay
        src="data:image/png;base64,"
        map={bigMap}
        textOf={(id) => (id === "title" ? "Old title" : "")}
        onSelect={vi.fn()}
        onEditText={vi.fn()}
        onDragEnd={vi.fn()}
      />,
    );
    fireEvent.doubleClick(document.querySelector<HTMLElement>('[data-element="title"]')!);
    const input = screen.getByDisplayValue("Old title");
    const inputZ = Number(input.style.zIndex);
    for (const id of bigMap.elements.map((e) => e.id)) {
      const hitboxZ = Number(document.querySelector<HTMLElement>(`[data-element="${id}"]`)!.style.zIndex);
      expect(inputZ).toBeGreaterThan(hitboxZ);
    }
  });

  it("double-clicking a second text element commits the first edit's unsaved value (#116 follow-up)", () => {
    const withXlabel: FigureHitmap = {
      ...MAP,
      elements: [...MAP.elements, { id: "xlabel", x0: 250, y0: 370, x1: 350, y1: 390 }],
    };
    const onEditText = vi.fn();
    render(
      <PreviewOverlay
        src="data:image/png;base64,"
        map={withXlabel}
        textOf={(id) => (id === "title" ? "Old title" : id === "xlabel" ? "Old x" : "")}
        onSelect={vi.fn()}
        onEditText={onEditText}
        onDragEnd={vi.fn()}
      />,
    );
    fireEvent.doubleClick(document.querySelector<HTMLElement>('[data-element="title"]')!);
    fireEvent.change(screen.getByDisplayValue("Old title"), { target: { value: "New title" } });
    fireEvent.doubleClick(document.querySelector<HTMLElement>('[data-element="xlabel"]')!);
    expect(onEditText).toHaveBeenCalledExactlyOnceWith("title", "New title");
    // the second edit is now open, seeded from its own current value
    expect(screen.getByDisplayValue("Old x")).toBeInTheDocument();
  });

  it("is keyboard-reachable: ContextMenu key / Shift+F10 open the menu, Enter selects (GUI_INTERACTION #8 parity)", () => {
    const { onSelect } = setup();
    const legend = el("legend");
    expect(legend).toHaveAttribute("tabindex", "0");
    expect(legend).toHaveAttribute("role", "button");
    expect(legend).toHaveAttribute("aria-label", "Legend — drag to move; right-click for properties");

    fireEvent.keyDown(legend, { key: "ContextMenu" });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByText("Legend")).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.keyDown(legend, { key: "F10", shiftKey: true });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });

    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(legend, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("legend");

    onSelect.mockClear();
    fireEvent.keyDown(legend, { key: " " });
    expect(onSelect).toHaveBeenCalledWith("legend");
  });
});
