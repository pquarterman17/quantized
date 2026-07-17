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

  // GUI_INTERACTION #9: an open menu owns Escape — it must not also reach a
  // window-level consumer underneath (e.g. the plot-tool Esc handler), or
  // closing this menu would have an unrelated side effect on the plot tool.
  it("stops Escape from propagating past the menu", () => {
    const onClose = vi.fn();
    const windowListener = vi.fn();
    window.addEventListener("keydown", windowListener);
    render(<ContextMenu x={0} y={0} items={items} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    window.removeEventListener("keydown", windowListener);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(windowListener).not.toHaveBeenCalled();
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

  it("renders a header, a checked action, and a swatch row", () => {
    const pick = vi.fn();
    render(
      <ContextMenu
        x={0}
        y={0}
        onClose={vi.fn()}
        items={[
          { header: "Series A" },
          { label: "Grid", run: vi.fn(), checked: true },
          { swatches: [{ key: "s1", title: "Series 1", css: "var(--series-1)", active: true, run: pick }] },
        ]}
      />,
    );
    expect(screen.getByText("Series A")).toHaveClass("qzk-ctx-header");
    expect(document.querySelector(".qzk-ctx-check")).toBeInTheDocument();
    const sw = screen.getByTitle("Series 1");
    expect(sw).toHaveClass("active");
    fireEvent.click(sw);
    expect(pick).toHaveBeenCalledOnce();
  });

  it("opens a submenu flyout on hover and runs a nested leaf (then closes)", () => {
    const leaf = vi.fn();
    const onClose = vi.fn();
    render(
      <ContextMenu
        x={0}
        y={0}
        onClose={onClose}
        items={[{ label: "More", submenu: [{ label: "Deep", run: leaf }] }]}
      />,
    );
    expect(screen.queryByText("Deep")).toBeNull(); // closed until hovered
    fireEvent.mouseEnter(screen.getByText("More").closest(".qzk-ctx-subwrap")!);
    fireEvent.click(screen.getByText("Deep"));
    expect(leaf).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("carries ARIA menu roles: menu / menuitem / menuitemcheckbox + aria-disabled", () => {
    render(
      <ContextMenu
        x={0}
        y={0}
        onClose={vi.fn()}
        items={[
          { label: "Rename", run: vi.fn() },
          { label: "Grid", run: vi.fn(), checked: true },
          { label: "Nope", run: vi.fn(), disabled: true },
        ]}
      />,
    );
    expect(document.querySelector('[role="menu"]')).toBeInTheDocument();
    expect(screen.getByText("Rename").closest("button")).toHaveAttribute("role", "menuitem");
    const grid = screen.getByText("Grid").closest("button")!;
    expect(grid).toHaveAttribute("role", "menuitemcheckbox");
    expect(grid).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Nope").closest("button")).toHaveAttribute("aria-disabled", "true");
  });
});

// GUI_INTERACTION #8: keyboard-complete navigation. The menu container grabs
// DOM focus on mount (see ContextMenu's own useLayoutEffect), so the first
// key fired at `document.activeElement` always lands on the menu itself.
describe("ContextMenu — keyboard navigation (GUI_INTERACTION #8)", () => {
  const nav: ContextMenuItem[] = [
    { label: "Alpha", run: vi.fn() },
    { separator: true },
    { label: "Beta", run: vi.fn(), disabled: true },
    { label: "Gamma", run: vi.fn() },
  ];

  it("ArrowDown from nothing focused lands on the first focusable item, skipping disabled", () => {
    render(<ContextMenu x={0} y={0} items={nav} onClose={vi.fn()} />);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByText("Alpha").closest("button"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByText("Gamma").closest("button")); // Beta is disabled
  });

  it("ArrowUp wraps from the first item to the last", () => {
    render(<ContextMenu x={0} y={0} items={nav} onClose={vi.fn()} />);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" }); // -> Alpha
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" }); // wraps -> Gamma
    expect(document.activeElement).toBe(screen.getByText("Gamma").closest("button"));
  });

  it("Home/End jump to the first/last focusable item", () => {
    render(<ContextMenu x={0} y={0} items={nav} onClose={vi.fn()} />);
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(screen.getByText("Gamma").closest("button"));
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(screen.getByText("Alpha").closest("button"));
  });

  it("a letter key type-ahead-jumps to the next matching item", () => {
    render(<ContextMenu x={0} y={0} items={nav} onClose={vi.fn()} />);
    fireEvent.keyDown(document.activeElement!, { key: "g" });
    expect(document.activeElement).toBe(screen.getByText("Gamma").closest("button"));
  });

  it("Esc closes AND returns focus to the element that was focused before the menu opened", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "trigger";
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const onClose = vi.fn();
    render(<ContextMenu x={0} y={0} items={nav} onClose={onClose} />);
    expect(document.activeElement).not.toBe(trigger); // the menu grabbed focus on open

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(trigger);
    document.body.removeChild(trigger);
  });

  it("ArrowRight opens a submenu and focuses its first item; ArrowLeft collapses back to the trigger", () => {
    const leaf = vi.fn();
    render(
      <ContextMenu
        x={0}
        y={0}
        onClose={vi.fn()}
        items={[{ label: "More", submenu: [{ label: "Deep", run: leaf }] }]}
      />,
    );
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" }); // -> "More"
    expect(document.activeElement).toBe(screen.getByText("More").closest("button"));

    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(screen.getByText("Deep")).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByText("Deep").closest("button"));

    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(screen.queryByText("Deep")).toBeNull(); // flyout collapsed
    expect(document.activeElement).toBe(screen.getByText("More").closest("button"));
  });

  it("Enter activates the focused item via the button's native click-on-Enter behaviour", () => {
    const run = vi.fn();
    const onClose = vi.fn();
    render(<ContextMenu x={0} y={0} onClose={onClose} items={[{ label: "Go", run }]} />);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    const btn = screen.getByText("Go").closest("button")!;
    expect(document.activeElement).toBe(btn);
    // jsdom doesn't synthesize the native Enter-triggers-click behaviour real
    // browsers give a focused <button> — exercise the click it would fire.
    fireEvent.click(btn);
    expect(run).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
