// Real-browser lesson: the opened menu's `role=menu` container is
// `display: contents`, which Chrome cannot focus, so a jsdom test that only
// fires keys at "whatever is focused" passes while a real user is stuck on the
// trigger. These tests pin WHERE focus lands (a menuitem, a real box).
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ContextMenu from "../overlays/ContextMenu";
import { useDialogFocus } from "../overlays/useDialogFocus";
import MenuBar from "./MenuBar";
import { accessMenuBar } from "../../lib/menubarAccess";
import { useCommands, type Action } from "../../store/commands";
import { pressEscape } from "../../test/pressEscape";

beforeEach(() => useCommands.setState({ menuCommands: [] }));
afterEach(() => useCommands.setState({ menuCommands: [] }));

async function warmMenus(): Promise<void> {
  fireEvent.pointerEnter(screen.getByRole("menubar"));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("MenuBar keyboard drive of an opened menu", () => {
  it("focuses the first menuitem on open; arrows/Home/End work; Escape returns to the trigger", async () => {
    const two: Action[] = [
      { id: "a", group: "File", label: "First item", run: vi.fn() },
      { id: "b", group: "File", label: "Second item", run: vi.fn() },
    ];
    render(<MenuBar actions={two} onOpenPalette={vi.fn()} />);
    await warmMenus();
    const file = screen.getByRole("menuitem", { name: "File" });
    file.focus();
    fireEvent.keyDown(file, { key: "ArrowDown" });
    await screen.findByRole("menu");
    const first = screen.getByRole("menuitem", { name: "First item" });
    const second = screen.getByRole("menuitem", { name: "Second item" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second, { key: "Home" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "End" });
    expect(second).toHaveFocus();
    await pressEscape(document);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(file).toHaveFocus();
  });
});

function Dialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const restore = useDialogFocus(ref, true);
  return (
    <div ref={ref} role="dialog" aria-label="Launched" tabIndex={-1}>
      <button
        onClick={() => {
          restore();
          onClose();
        }}
      >
        Close dialog
      </button>
    </div>
  );
}

function Host() {
  const [menu, setMenu] = useState(false);
  const [dlg, setDlg] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={trigger} onClick={() => setMenu(true)}>
        Trigger
      </button>
      {menu && (
        <ContextMenu
          x={0}
          y={0}
          returnFocus={trigger.current}
          onClose={() => setMenu(false)}
          items={[{ label: "Open dialog", run: () => setDlg(true) }]}
        />
      )}
      {dlg && <Dialog onClose={() => setDlg(false)} />}
    </>
  );
}

describe("menu-launched dialog focus return", () => {
  it("falls back to the menu's trigger when the opener (the menu item) is gone", async () => {
    render(<Host />);
    const trigger = screen.getByRole("button", { name: "Trigger" });
    trigger.focus();
    fireEvent.click(trigger);
    const item = await screen.findByRole("menuitem", { name: "Open dialog" });
    expect(item).toHaveFocus();
    fireEvent.click(item);
    await screen.findByRole("dialog");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    await act(async () => {});
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

describe("MenuBar Alt/F10 access and names (UX menus N13; provisional, owner to confirm)", () => {
  const acts: Action[] = [{ id: "u", group: "Edit", label: "Undo", disabled: true, disabledReason: "Nothing to undo", run: vi.fn() }];

  it("the access event opens the named menu, names it, and reaches the disabled row by keyboard", async () => {
    render(<MenuBar actions={acts} onOpenPalette={vi.fn()} />);
    await warmMenus();
    await act(async () => {
      accessMenuBar("Edit");
    });
    expect(await screen.findByRole("menu", { name: "Edit" })).toBeInTheDocument();
    const undo = screen.getByRole("menuitem", { name: "Undo" });
    expect(undo).toHaveAttribute("aria-disabled", "true");
    expect(undo).toHaveFocus();
    expect(undo).toHaveAccessibleDescription("Nothing to undo");
    expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveAttribute("aria-keyshortcuts", "Alt+E");
  });

  it("with no label (F10) focus lands on the bar without opening a menu", async () => {
    render(<MenuBar actions={acts} onOpenPalette={vi.fn()} />);
    await warmMenus();
    await act(async () => {
      accessMenuBar();
    });
    expect(screen.getByRole("menuitem", { name: "File" })).toHaveFocus();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
