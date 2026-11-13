// Load-failure contract for the three on-demand surfaces of bundle diet slice
// 26 (plans/BUNDLE_HEADROOM.md; cold opens are in onDemandMenus.test.tsx). A
// body whose chunk will not load must not unmount anything or reach an error
// boundary, must close the surface it was asked to show (so no open flag is
// left with nothing on screen), must say so in a danger toast, and must try
// again on the next open. Each body's module factory throws while its `fail`
// flag is set, which is what a failed chunk fetch looks like to `import()`.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

import ContextMenu from "./ContextMenuLazy";
import CommandPaletteGate from "./CommandPaletteGate";
import AppearanceMenu from "../Shell/AppearanceMenu";
import { useToasts } from "../../store/toasts";
import { useApp } from "../../store/useApp";

const { fail } = vi.hoisted(() => ({ fail: { menu: true, palette: true, appearance: true } }));
vi.mock("./ContextMenu", async (importOriginal: () => Promise<Record<string, unknown>>) => {
  if (fail.menu) throw new Error("chunk fetch failed");
  return await importOriginal();
});
vi.mock("./CommandPalette", async (importOriginal: () => Promise<Record<string, unknown>>) => {
  if (fail.palette) throw new Error("chunk fetch failed");
  return await importOriginal();
});
vi.mock("../Shell/AppearancePanel", async (importOriginal: () => Promise<Record<string, unknown>>) => {
  if (fail.appearance) throw new Error("chunk fetch failed");
  return await importOriginal();
});

const toastTexts = () => useToasts.getState().toasts.map((t) => t.msg);
const flushRejection = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

let errorSpy: MockInstance;
beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  useToasts.setState({ toasts: [] });
  useApp.setState({ cmdkOpen: false });
});
afterEach(() => {
  // Nothing reached a React error boundary or an uncaught-error log.
  expect(errorSpy).not.toHaveBeenCalled();
  errorSpy.mockRestore();
});

describe("on-demand surfaces whose body will not load", () => {
  it("a context menu closes through its host and toasts, then loads on the next open", async () => {
    const onClose = vi.fn();
    const items = [{ label: "Rename", run: () => {} }];
    const view = render(<ContextMenu x={0} y={0} items={items} onClose={onClose} />);
    await vi.waitFor(() => expect(toastTexts()).toContain("Could not load the menu. Try again."));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    view.unmount();

    fail.menu = false;
    render(<ContextMenu x={0} y={0} items={items} onClose={onClose} />);
    expect(await screen.findByRole("menuitem", { name: "Rename" })).toBeInTheDocument();
  });

  it("the ⌘K palette clears its open flag and toasts, then opens on the next ⌘K", async () => {
    render(<CommandPaletteGate actions={[]} />);
    await flushRejection(); // the gate's own warm attempt fails quietly
    expect(toastTexts()).toEqual([]);
    act(() => useApp.getState().setCmdk(true));
    await vi.waitFor(() => expect(useApp.getState().cmdkOpen).toBe(false));
    expect(toastTexts()).toContain("Could not load the command palette. Try again.");
    expect(screen.queryByRole("dialog")).toBeNull();

    fail.palette = false;
    act(() => useApp.getState().setCmdk(true));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("the Appearance dropdown closes and toasts, then opens on the next click", async () => {
    render(<AppearanceMenu />);
    await flushRejection();
    expect(toastTexts()).toEqual([]);
    const gear = screen.getByRole("button", { name: "Appearance" });
    fireEvent.click(gear);
    await vi.waitFor(() => expect(toastTexts()).toContain("Could not load the Appearance menu. Try again."));
    expect(gear).not.toHaveClass("active");
    expect(screen.queryByText("Theme")).toBeNull();

    fail.appearance = false;
    fireEvent.click(gear);
    expect(await screen.findByText("Theme")).toBeInTheDocument();
  });
});
