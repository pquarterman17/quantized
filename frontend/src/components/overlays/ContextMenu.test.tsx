import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ContextMenu, { type ContextMenuItem } from "./ContextMenu";

describe("ContextMenu", () => {
  const items: ContextMenuItem[] = [
    { label: "Rename", run: vi.fn() },
    { separator: true },
    { label: "Disabled", run: vi.fn(), disabled: true },
    { label: "Remove", run: vi.fn(), danger: true },
  ];

  it("renders labels, a separator, and a danger item", () => {
    render(<ContextMenu x={10} y={10} items={items} onClose={vi.fn()} />);
    expect(screen.getByText("Rename")).toBeInTheDocument();
    expect(screen.getByText("Remove").closest("button")).toHaveClass("danger");
    expect(document.querySelector(".qzk-ctx-sep")).toBeInTheDocument();
  });

  it("runs an item then closes", () => {
    const run = vi.fn();
    const onClose = vi.fn();
    render(<ContextMenu x={0} y={0} items={[{ label: "Go", run }]} onClose={onClose} />);
    fireEvent.click(screen.getByText("Go"));
    expect(run).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("a disabled item does not fire its action", () => {
    const run = vi.fn();
    render(<ContextMenu x={0} y={0} items={[{ label: "Nope", run, disabled: true }]} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("Nope"));
    expect(run).not.toHaveBeenCalled();
  });

  it("closes on Escape and on an outside mousedown", () => {
    const onClose = vi.fn();
    render(<ContextMenu x={0} y={0} items={items} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  // A portaled child's synthetic click still bubbles through the REACT tree
  // (not the DOM tree) to whatever rendered <ContextMenu> — e.g. a Library
  // row's own onClick. Without stopPropagation, clicking a menu item would
  // ALSO fire the host's click handler (WORKSHEET_PLAN item 15 surfaced this
  // via "Plot (make active)" spuriously re-triggering the row's own click
  // routing right after).
  it("an item click does not bubble to an ancestor's onClick (React-tree portal bubbling)", () => {
    const run = vi.fn();
    const hostClick = vi.fn();
    render(
      <div onClick={hostClick}>
        <ContextMenu x={0} y={0} items={[{ label: "Go", run }]} onClose={vi.fn()} />
      </div>,
    );
    fireEvent.click(screen.getByText("Go"));
    expect(run).toHaveBeenCalledOnce();
    expect(hostClick).not.toHaveBeenCalled();
  });

  it("portals to document.body (escapes overflow-clipped panels)", () => {
    const { container } = render(<ContextMenu x={0} y={0} items={items} onClose={vi.fn()} />);
    // The menu is not a descendant of the render container — it lives on body.
    expect(container.querySelector(".qzk-ctx")).toBeNull();
    expect(document.body.querySelector(".qzk-ctx")).toBeInTheDocument();
  });
});
