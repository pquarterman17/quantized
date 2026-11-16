// Bundle diet slice 31: the panel family (AppOverlayPanels.tsx) loads as one
// chunk after the overlay shell mounts. This forces both races on that seam:
// a load that fails (a danger toast, and the next gesture asks again), and a panel flag
// set while the chunk is still in flight (the panel mounts once it lands,
// reading the store's current state).

import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AppOverlays from "./AppOverlays";
import { useHelp } from "./store/help";

const overlaysSrc = Object.values(
  import.meta.glob("./AppOverlays.tsx", { query: "?raw", import: "default", eager: true }),
)[0] as string;

let fail = true;
let release: () => void = () => {};
const gate = new Promise<void>((resolve) => {
  release = resolve;
});

vi.mock("./AppOverlayPanels", async (importOriginal) => {
  if (fail) throw new Error("chunk fetch failed");
  await gate;
  return importOriginal();
});

describe("AppOverlays loads its panel family after mount (bundle diet slice 31)", () => {
  it("toasts a failed load, retries on the next gesture, and mounts a panel opened while the chunk was in flight", async () => {
    useHelp.setState({ whatIsThis: false });
    render(<AppOverlays />);

    // The always-on overlays do not wait for the chunk: the Toaster is the
    // one that reports its failure.
    expect(await screen.findByText(/Panels and dialogs could not load/)).toBeInTheDocument();

    fail = false;
    // Any pointer or key press anywhere asks again.
    fireEvent.keyDown(window, { key: "Shift" });
    // Opened while the retried load is still in flight.
    act(() => useHelp.getState().setWhatIsThis(true));
    expect(screen.queryByText("Point at a highlighted control to see what it does")).not.toBeInTheDocument();

    await act(async () => {
      release();
      await gate;
    });
    expect(await screen.findByText("Point at a highlighted control to see what it does")).toBeInTheDocument();
  });
});

describe("AppOverlays keeps the single component's DOM order", () => {
  it("places the three panel parts around TooltipLayer and InteractionHints, with Param/Confirm/Toaster last (R12)", () => {
    const order = [
      '<Panels part="lead" />',
      "<TooltipLayer />",
      '<Panels part="whatIsThis" />',
      "<InteractionHints />",
      '<Panels part="main" />',
      "<ParamDialog />",
      "<ConfirmDialog />",
      "<Toaster />",
    ].map((tag) => overlaysSrc.indexOf(tag));
    expect(order.every((i) => i >= 0), "every mount is present").toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});
