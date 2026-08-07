// FIGURE_AUTHORING_WORKFLOW_PLAN F3.4: double-click, right-click, keyboard
// (ContextMenu key/Shift+F10, Enter, Delete) panel-editing paths — mirrors
// Library/DatasetRow.test.tsx's fireEvent conventions for the same shared
// <ContextMenu/> component.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PageSlot, PanelSourceStatus } from "../../../lib/figurepage";
import SlotGrid from "./SlotGrid";

const FIGURE_SLOT: PageSlot = { source: { kind: "figure", id: "f1", name: "Loop" }, label: null, title: null };
const WINDOW_SLOT: PageSlot = { source: { kind: "window", id: "w1", name: "Loop A" }, label: null, title: null };
const FIGDOC_SLOT: PageSlot = { source: { kind: "figdoc", id: "d1", name: "Old figure" }, label: null, title: null };
const EMPTY_SLOT: PageSlot = { source: null, label: null, title: null };

function baseProps(slots: PageSlot[], statuses: PanelSourceStatus[]) {
  return {
    rows: 1,
    cols: slots.length,
    slots,
    labels: slots.map((s) => (s.source ? "(a)" : "")),
    statuses,
    selected: null,
    onSelect: vi.fn(),
    onClear: vi.fn(),
    onDropSource: vi.fn(),
    onEdit: vi.fn(),
    onSaveAsFigure: vi.fn(),
    onPromote: vi.fn(),
    onDuplicateForPage: vi.fn(),
  };
}

describe("SlotGrid panel editing (F3.4)", () => {
  it("double-click on a figure-kind slot calls onEdit", () => {
    const props = baseProps([FIGURE_SLOT], [{ status: "ok", lifecycle: "live" }]);
    const { container } = render(<SlotGrid {...props} />);
    fireEvent.doubleClick(container.querySelectorAll("[tabindex]")[0]);
    expect(props.onEdit).toHaveBeenCalledOnce();
  });

  it("double-click on a window-kind slot calls onEdit (focus/restore its window)", () => {
    const props = baseProps([WINDOW_SLOT], [{ status: "ok", lifecycle: "live" }]);
    const { container } = render(<SlotGrid {...props} />);
    fireEvent.doubleClick(container.querySelectorAll("[tabindex]")[0]);
    expect(props.onEdit).toHaveBeenCalledOnce();
  });

  it("double-click on a figdoc-kind slot calls onPromote, not onEdit", () => {
    const props = baseProps([FIGDOC_SLOT], [{ status: "ok", lifecycle: "frozen" }]);
    const { container } = render(<SlotGrid {...props} />);
    fireEvent.doubleClick(container.querySelectorAll("[tabindex]")[0]);
    expect(props.onPromote).toHaveBeenCalledOnce();
    expect(props.onEdit).not.toHaveBeenCalled();
  });

  it("double-click on an empty slot is a no-op (nothing to edit)", () => {
    const props = baseProps([EMPTY_SLOT], [{ status: "empty" }]);
    const { container } = render(<SlotGrid {...props} />);
    fireEvent.doubleClick(container.querySelectorAll("[tabindex]")[0]);
    expect(props.onEdit).not.toHaveBeenCalled();
    expect(props.onPromote).not.toHaveBeenCalled();
  });

  it("double-click on a missing-status slot is a no-op — never invents an edit target", () => {
    const props = baseProps([FIGURE_SLOT], [{ status: "missing" }]);
    const { container } = render(<SlotGrid {...props} />);
    fireEvent.doubleClick(container.querySelectorAll("[tabindex]")[0]);
    expect(props.onEdit).not.toHaveBeenCalled();
  });

  it("right-click on a figure-kind slot opens the menu with Edit/Duplicate/Clear", () => {
    const props = baseProps([FIGURE_SLOT], [{ status: "ok", lifecycle: "live" }]);
    const { container } = render(<SlotGrid {...props} />);
    fireEvent.contextMenu(container.querySelectorAll("[tabindex]")[0]);
    expect(screen.getByText("Edit figure")).toBeInTheDocument();
    expect(screen.getByText("Duplicate for this page")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Duplicate for this page"));
    expect(props.onDuplicateForPage).toHaveBeenCalledOnce();
  });

  it("right-click on a window-kind slot offers Save as editable figure", () => {
    const props = baseProps([WINDOW_SLOT], [{ status: "ok", lifecycle: "live" }]);
    const { container } = render(<SlotGrid {...props} />);
    fireEvent.contextMenu(container.querySelectorAll("[tabindex]")[0]);
    fireEvent.click(screen.getByText("Save as editable figure"));
    expect(props.onSaveAsFigure).toHaveBeenCalledOnce();
  });

  it("right-click on a missing slot offers ONLY Clear panel", () => {
    const props = baseProps([FIGURE_SLOT], [{ status: "missing" }]);
    const { container } = render(<SlotGrid {...props} />);
    fireEvent.contextMenu(container.querySelectorAll("[tabindex]")[0]);
    expect(screen.getByText("Clear panel")).toBeInTheDocument();
    expect(screen.queryByText("Edit figure")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Clear panel"));
    expect(props.onClear).toHaveBeenCalledOnce();
  });

  it("right-click on an empty slot opens no menu (nothing to act on)", () => {
    const props = baseProps([EMPTY_SLOT], [{ status: "empty" }]);
    const { container } = render(<SlotGrid {...props} />);
    fireEvent.contextMenu(container.querySelectorAll("[tabindex]")[0]);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("is focusable and opens the SAME menu on the ContextMenu key", () => {
    const props = baseProps([FIGURE_SLOT], [{ status: "ok", lifecycle: "live" }]);
    const { container } = render(<SlotGrid {...props} />);
    const slot = container.querySelectorAll("[tabindex]")[0];
    fireEvent.keyDown(slot, { key: "ContextMenu" });
    expect(screen.getByText("Edit figure")).toBeInTheDocument();
  });

  it("also opens on Shift+F10", () => {
    const props = baseProps([FIGURE_SLOT], [{ status: "ok", lifecycle: "live" }]);
    const { container } = render(<SlotGrid {...props} />);
    fireEvent.keyDown(container.querySelectorAll("[tabindex]")[0], { key: "F10", shiftKey: true });
    expect(screen.getByText("Edit figure")).toBeInTheDocument();
  });

  it("Enter runs the primary action (figure kind: onEdit)", () => {
    const props = baseProps([FIGURE_SLOT], [{ status: "ok", lifecycle: "live" }]);
    const { container } = render(<SlotGrid {...props} />);
    fireEvent.keyDown(container.querySelectorAll("[tabindex]")[0], { key: "Enter" });
    expect(props.onEdit).toHaveBeenCalledOnce();
  });

  it("Enter on a missing slot does nothing (no primary action)", () => {
    const props = baseProps([FIGURE_SLOT], [{ status: "missing" }]);
    const { container } = render(<SlotGrid {...props} />);
    fireEvent.keyDown(container.querySelectorAll("[tabindex]")[0], { key: "Enter" });
    expect(props.onEdit).not.toHaveBeenCalled();
  });

  it("Delete clears a filled slot — the keyboard equivalent of the × chip", () => {
    const props = baseProps([FIGURE_SLOT], [{ status: "ok", lifecycle: "live" }]);
    const { container } = render(<SlotGrid {...props} />);
    fireEvent.keyDown(container.querySelectorAll("[tabindex]")[0], { key: "Delete" });
    expect(props.onClear).toHaveBeenCalledOnce();
  });

  it("Backspace also clears a filled slot", () => {
    const props = baseProps([WINDOW_SLOT], [{ status: "ok", lifecycle: "live" }]);
    const { container } = render(<SlotGrid {...props} />);
    fireEvent.keyDown(container.querySelectorAll("[tabindex]")[0], { key: "Backspace" });
    expect(props.onClear).toHaveBeenCalledOnce();
  });

  it("Delete on an empty slot does nothing", () => {
    const props = baseProps([EMPTY_SLOT], [{ status: "empty" }]);
    const { container } = render(<SlotGrid {...props} />);
    fireEvent.keyDown(container.querySelectorAll("[tabindex]")[0], { key: "Delete" });
    expect(props.onClear).not.toHaveBeenCalled();
  });
});

describe("SlotGrid transient-source tooltip (F3.4 unification decision)", () => {
  it("names a window-kind panel as not-yet-durable", () => {
    const props = baseProps([WINDOW_SLOT], [{ status: "ok", lifecycle: "live" }]);
    const { container } = render(<SlotGrid {...props} />);
    const span = Array.from(container.querySelectorAll("span")).find((el) =>
      el.textContent?.includes("Loop A"),
    );
    expect(span?.getAttribute("title")).toMatch(/not yet a saved figure/);
  });

  it("frozen note wins over the transient note when a figdoc is ALSO frozen", () => {
    const props = baseProps([FIGDOC_SLOT], [{ status: "ok", lifecycle: "frozen" }]);
    const { container } = render(<SlotGrid {...props} />);
    const span = Array.from(container.querySelectorAll("span")).find((el) =>
      el.textContent?.includes("Old figure"),
    );
    expect(span?.getAttribute("title")).toMatch(/frozen snapshot/);
  });

  it("names a live figdoc-kind panel as export-only", () => {
    const props = baseProps([FIGDOC_SLOT], [{ status: "ok", lifecycle: "live" }]);
    const { container } = render(<SlotGrid {...props} />);
    const span = Array.from(container.querySelectorAll("span")).find((el) =>
      el.textContent?.includes("Old figure"),
    );
    expect(span?.getAttribute("title")).toMatch(/Publication figure \(export-only\)/);
  });

  it("a figure-kind panel's tooltip carries no transient note — it is already durable", () => {
    const props = baseProps([FIGURE_SLOT], [{ status: "ok", lifecycle: "live" }]);
    const { container } = render(<SlotGrid {...props} />);
    const span = Array.from(container.querySelectorAll("span")).find((el) =>
      el.textContent?.includes("Loop"),
    );
    expect(span?.getAttribute("title")).toBe("Loop");
  });
});
