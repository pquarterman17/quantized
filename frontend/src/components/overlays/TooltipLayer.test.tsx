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

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("TooltipLayer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("renders nothing until something is hovered or focused", () => {
    renderTarget({ "data-tip": "Zoom", "data-tip-desc": "Drag a box to zoom into a region" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows the bold name + one-line description after the dwell, on hover", () => {
    const el = renderTarget({ "data-tip": "Zoom", "data-tip-desc": "Drag a box to zoom into a region" });
    fireEvent.mouseOver(el);
    expect(screen.queryByRole("tooltip")).toBeNull(); // not yet — dwell hasn't elapsed
    advance(400);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    expect(screen.getByText("Zoom")).toBeInTheDocument();
    expect(screen.getByText("Drag a box to zoom into a region")).toBeInTheDocument();
  });

  it("shows the keyboard shortcut chip when data-tip-key is present", () => {
    const el = renderTarget({ "data-tip": "Zoom", "data-tip-key": "Z" });
    fireEvent.mouseOver(el);
    advance(400);
    expect(screen.getByText("Z")).toBeInTheDocument();
  });

  it("omits the description line when data-tip-desc is absent (MenuBar's plain usage)", () => {
    const el = renderTarget({ "data-tip": "Command palette", "data-tip-key": "⌘K" });
    fireEvent.mouseOver(el);
    advance(400);
    expect(screen.getByText("Command palette")).toBeInTheDocument();
    expect(screen.getByText("⌘K")).toBeInTheDocument();
    expect(screen.getByRole("tooltip").querySelector(".qz-tip-desc")).toBeNull();
  });

  it("shows on keyboard focus, not just hover", () => {
    const el = renderTarget({ "data-tip": "Pan", "data-tip-desc": "Drag to pan the view" });
    fireEvent.focusIn(el);
    advance(400);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    expect(screen.getByText("Pan")).toBeInTheDocument();
  });

  it("hides on blur (focusout)", () => {
    const el = renderTarget({ "data-tip": "Pan" });
    fireEvent.focusIn(el);
    advance(400);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    act(() => {
      fireEvent.focusOut(el);
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("hides on mouseout before the dwell fires (no flicker from a quick pass-over)", () => {
    const el = renderTarget({ "data-tip": "Pan" });
    fireEvent.mouseOver(el);
    advance(100);
    act(() => {
      fireEvent.mouseOut(el);
    });
    advance(400);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("dismisses on Escape while visible", () => {
    const el = renderTarget({ "data-tip": "Pan" });
    fireEvent.mouseOver(el);
    advance(400);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("ignores elements with no data-tip attribute", () => {
    render(
      <>
        <button data-testid="plain">plain</button>
        <TooltipLayer />
      </>,
    );
    fireEvent.mouseOver(screen.getByTestId("plain"));
    advance(400);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
