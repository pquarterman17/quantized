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
});
afterEach(() => {
  errorSpy.mockRestore();
});

describe("AppOverlays panel family survives a failed chunk fetch (UX-003)", () => {
  it("degrades only the failing panel, surfaces the failure, and a retry recovers", async () => {
    const { container } = render(<AppOverlays />);

    act(() => {
      useApp.getState().setShortcutsOpen(true);
    });

    expect(await screen.findByText("⚠ Panel failed to load.")).toBeInTheDocument();
    // The rest of AppOverlays' tree survives the failing panel — a blank
    // REGION only, never a blank app (the container React renders into is
    // still attached and still has content beyond the fallback itself).
    expect(container.isConnected).toBe(true);
    expect(container.querySelector(".qzk-lazy-fail")).toBeTruthy();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    shortcutsShouldFail = false;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    });

    expect(await screen.findByText("real shortcuts dialog")).toBeInTheDocument();
    expect(screen.queryByText("⚠ Panel failed to load.")).not.toBeInTheDocument();
  });
});
