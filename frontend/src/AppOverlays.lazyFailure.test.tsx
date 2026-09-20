// UX-003, real seam-family coverage: exercises the ACTUAL AppOverlays panel
// registry (the `lazyPanel()` family — 52 workshop panels + on-demand
// dialogs, all sharing one `lazyRegion()` call site, see AppOverlays.tsx)
// against a genuinely mocked module path, not a synthetic loader.
// `src/lib/lazyRegion.test.tsx` proves the general mechanism; this proves it
// holds for a real production call site wired through the real composition
// root.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

import AppOverlays from "./AppOverlays";
import { useApp } from "./store/useApp";
import { useHelp } from "./store/help";

let shortcutsShouldFail = true;
vi.mock("./components/overlays/ShortcutsDialog", () => {
  if (shortcutsShouldFail) throw new Error("chunk fetch failed");
  return { default: () => <div>real shortcuts dialog</div> };
});

let errorSpy: MockInstance;
beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  shortcutsShouldFail = true;
  useApp.setState({ datasets: [], activeId: null, toolWindowLayout: {}, shortcutsOpen: false });
  useHelp.setState({ whatIsThis: false });
});
afterEach(() => {
  errorSpy.mockRestore();
});

describe("AppOverlays panel family survives a failed chunk fetch (UX-003)", () => {
  it("degrades only the failing panel, surfaces the failure, and a retry recovers", async () => {
    render(<AppOverlays />);

    // A SECOND, unrelated overlay (WhatIsThis, its own lazyPanel() seam) is
    // opened alongside the failing one — real evidence a sibling survives,
    // not just that the container div is still in the DOM (a vacuous check:
    // it stays `isConnected` even after the whole React root unmounts).
    act(() => {
      useHelp.getState().setWhatIsThis(true);
      useApp.getState().setShortcutsOpen(true);
    });

    expect(await screen.findByText("⚠ ShortcutsDialog failed to load.")).toBeInTheDocument();
    expect(screen.getByText("Point at a highlighted control to see what it does")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    shortcutsShouldFail = false;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    });

    expect(await screen.findByText("real shortcuts dialog")).toBeInTheDocument();
    expect(screen.queryByText(/failed to load/)).not.toBeInTheDocument();
    // The sibling overlay, opened before the retry, is still there and
    // still its own live component — untouched by the failing panel's
    // whole load/fail/retry cycle.
    expect(screen.getByText("Point at a highlighted control to see what it does")).toBeInTheDocument();
  });
});
