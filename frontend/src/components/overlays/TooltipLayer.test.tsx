// GUI_INTERACTION_PLAN #7 (plot-toolbar legibility): TooltipLayer now renders
// a bold NAME + one-line BEHAVIOUR description + optional keyboard SHORTCUT,
// shows on keyboard focus (not just hover), and dismisses on Escape. These
// tests exercise the delegated listener directly against a plain [data-tip]
// element (decoupled from any real toolbar button) since the mechanism is
// generic — any element in the app can opt in with the same attributes.
//
// The dwell fires from a fake-timer setTimeout, which lands OUTSIDE any React
// event handler — advanceTimersByTime must be wrapped in act() or the
// resulting setState never flushes to the DOM before the assertion runs.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TooltipLayer from "./TooltipLayer";
import { useHelp } from "../../store/help";

function renderTarget(attrs: Record<string, string>) {
  render(
    <>
      <button data-testid="target" {...attrs}>
        btn
      </button>
      <TooltipLayer />
    </>,
  );
  return screen.getByTestId("target");
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    // TooltipBubble is intentionally split from the eager shell. Await the
    // same module before asserting so these fake-timer tests cover its first
    // lazy render instead of relying on transform-cache timing.
    await import("./TooltipBubble");
  });
}

describe("TooltipLayer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useHelp.setState({ whatIsThis: false });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    useHelp.setState({ whatIsThis: false });
  });

  it("renders nothing until something is hovered or focused", () => {
    renderTarget({ "data-tip": "Zoom", "data-tip-desc": "Drag a box to zoom into a region" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows the bold name + one-line description after the dwell, on hover", async () => {
    const el = renderTarget({ "data-tip": "Zoom", "data-tip-desc": "Drag a box to zoom into a region" });
    fireEvent.mouseOver(el);
    expect(screen.queryByRole("tooltip")).toBeNull(); // not yet — dwell hasn't elapsed
    await advance(400);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    expect(screen.getByText("Zoom")).toBeInTheDocument();
    expect(screen.getByText("Drag a box to zoom into a region")).toBeInTheDocument();
  });

  it("shows the keyboard shortcut chip when data-tip-key is present", async () => {
    const el = renderTarget({ "data-tip": "Zoom", "data-tip-key": "Z" });
    fireEvent.mouseOver(el);
    await advance(400);
    expect(screen.getByText("Z")).toBeInTheDocument();
  });

  it("omits the description line when data-tip-desc is absent (MenuBar's plain usage)", async () => {
    const el = renderTarget({ "data-tip": "Command palette", "data-tip-key": "⌘K" });
    fireEvent.mouseOver(el);
    await advance(400);
    expect(screen.getByText("Command palette")).toBeInTheDocument();
    expect(screen.getByText("⌘K")).toBeInTheDocument();
    expect(screen.getByRole("tooltip").querySelector(".qz-tip-desc")).toBeNull();
  });

  it("shows on keyboard focus, not just hover", async () => {
    const el = renderTarget({ "data-tip": "Pan", "data-tip-desc": "Drag to pan the view" });
    fireEvent.focusIn(el);
    await advance(400);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    expect(screen.getByText("Pan")).toBeInTheDocument();
  });

  it("hides on blur (focusout)", async () => {
    const el = renderTarget({ "data-tip": "Pan" });
    fireEvent.focusIn(el);
    await advance(400);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    act(() => {
      fireEvent.focusOut(el);
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("hides on mouseout before the dwell fires (no flicker from a quick pass-over)", async () => {
    const el = renderTarget({ "data-tip": "Pan" });
    fireEvent.mouseOver(el);
    await advance(100);
    act(() => {
      fireEvent.mouseOut(el);
    });
    await advance(400);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("dismisses on Escape while visible", async () => {
    const el = renderTarget({ "data-tip": "Pan" });
    fireEvent.mouseOver(el);
    await advance(400);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("ignores elements with no data-tip attribute", async () => {
    render(
      <>
        <button data-testid="plain">plain</button>
        <TooltipLayer />
      </>,
    );
    fireEvent.mouseOver(screen.getByTestId("plain"));
    await advance(400);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
  it("reveals help INSTANTLY (no dwell) in what-is-this mode", async () => {
    // The mode's whole point: point at a control and see its help at once.
    act(() => useHelp.getState().setWhatIsThis(true));
    const el = renderTarget({ "data-tip": "Zoom", "data-tip-desc": "Drag a box to zoom into a region" });
    fireEvent.mouseOver(el);
    // No dwell advance — only allow the on-demand renderer to resolve.
    await advance(0);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    expect(screen.getByText("Zoom")).toBeInTheDocument();
  });

  it("keeps the 400ms dwell when the mode is off", async () => {
    const el = renderTarget({ "data-tip": "Zoom" });
    fireEvent.mouseOver(el);
    expect(screen.queryByRole("tooltip")).toBeNull();
    await advance(399);
    expect(screen.queryByRole("tooltip")).toBeNull();
    await advance(1);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  // Chrome audit round 4: a tip is centred on its control, so the Inspector's
  // "?" buttons and the search pill (both at the window's right edge) had
  // their tips cut off by it. jsdom has no layout: the tip's box is stubbed.
  it("shifts a tip that would leave the window back inside it", async () => {
    const W = window.innerWidth;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const off = this.classList.contains("qz-tip") ? parseFloat(this.style.marginLeft || "0") : 0;
      const left = W - 60 + off; // 120px wide, centred 60px from the right edge... and so half outside
      return { x: left, y: 200, left, top: 200, width: 120, height: 30, right: left + 120, bottom: 230, toJSON: () => ({}) } as DOMRect;
    });
    const el = renderTarget({ "data-tip": "Open related help" });
    fireEvent.mouseOver(el);
    await advance(400);
    const tip = screen.getByRole("tooltip");
    expect(parseFloat(tip.style.marginLeft)).toBe(-68); // 60px over the edge + an 8px margin
  });
});
