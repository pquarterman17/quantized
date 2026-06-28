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

  it("portals to document.body (escapes overflow-clipped panels)", () => {
    const { container } = render(<ContextMenu x={0} y={0} items={items} onClose={vi.fn()} />);
    // The menu is not a descendant of the render container — it lives on body.
    expect(container.querySelector(".qzk-ctx")).toBeNull();
    expect(document.body.querySelector(".qzk-ctx")).toBeInTheDocument();
  });
});
