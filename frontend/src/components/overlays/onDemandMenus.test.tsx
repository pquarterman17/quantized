// Cold first opens of the three on-demand surfaces of bundle diet slice 26
// (plans/BUNDLE_HEADROOM.md): the context-menu body behind
// ContextMenuLazy.tsx, the ⌘K palette behind CommandPaletteGate.tsx and the
// Appearance dropdown's body (AppearanceMenu.test.tsx covers that one; it is
// cold in every test there). The app warms each body once its host mounts, so
// a real first open is normally warm; these pin what happens when it is not:
// the surface still appears, whole, and focus behaves as it did when the body
// was eager. The load-failure half is onDemandMenus.loadFail.test.tsx.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ContextMenu from "./ContextMenuLazy";
import CommandPaletteGate from "./CommandPaletteGate";
import type { Action } from "../../store/commands";
import { useApp } from "../../store/useApp";

beforeEach(() => {
  useApp.setState({ cmdkOpen: false });
});

describe("ContextMenuLazy, cold", () => {
  it("renders nothing until the body has loaded, then the whole menu", async () => {
    const run = vi.fn();
    const onClose = vi.fn();
    render(<ContextMenu x={10} y={10} items={[{ label: "Rename", run }]} onClose={onClose} />);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it("still hands focus back to the opener on Escape", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const onClose = vi.fn();
    render(<ContextMenu x={10} y={10} items={[{ label: "Rename", run: () => {} }]} onClose={onClose} />);
    await screen.findByRole("menu");
    // The body focuses its own container on mount, as it did when eager.
    expect(opener).not.toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    expect(opener).toHaveFocus();
    opener.remove();
  });
});

describe("CommandPaletteGate", () => {
  const actions: Action[] = [{ id: "demo", group: "File", label: "Load demo dataset", run: () => {} }];

  it("mounts no palette while closed, and opens a ⌘K pressed before the body loaded", async () => {
    render(<CommandPaletteGate actions={actions} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => useApp.getState().setCmdk(true));
    expect(await screen.findByRole("option", { name: /Load demo dataset/ })).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes and reopens through the palette's own flag once loaded", async () => {
    render(<CommandPaletteGate actions={actions} />);
    act(() => useApp.getState().setCmdk(true));
    await screen.findByRole("dialog");
    act(() => useApp.getState().setCmdk(false));
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => useApp.getState().setCmdk(true));
    // Warm now: the reopen renders on the same commit, no wait.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
