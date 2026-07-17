// GUI_INTERACTION #9 item 3: right-click must cancel a half-drawn region
// BEFORE the menu opens — never leave it stranded under an opened menu, and
// never silently swallow the click the way the old `e.buttons & 1` guard did.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { setActiveGestureCancel } from "../../lib/gestureCancel";
import type { PlotPayload } from "../../lib/plotdata";
import { useStageContextMenu } from "./useStageContextMenu";

const PAYLOAD: PlotPayload = { data: [[]], series: [], xLabel: "x", xUnit: "" };

function fakeMouseEvent(x: number, y: number): React.MouseEvent {
  return {
    clientX: x,
    clientY: y,
    preventDefault: vi.fn(),
  } as unknown as React.MouseEvent;
}

beforeEach(() => {
  setActiveGestureCancel(null);
});

describe("useStageContextMenu", () => {
  it("does nothing with no plot payload", () => {
    const { result } = renderHook(() => useStageContextMenu(null));
    act(() => result.current.onStageContextMenu(fakeMouseEvent(10, 20)));
    expect(result.current.menu).toBeNull();
  });

  it("cancels an in-progress gesture, then always opens the menu", () => {
    const cancel = vi.fn();
    setActiveGestureCancel(cancel);
    const { result } = renderHook(() => useStageContextMenu(PAYLOAD));
    act(() => result.current.onStageContextMenu(fakeMouseEvent(10, 20)));
    expect(cancel).toHaveBeenCalledOnce();
    expect(result.current.menu).toEqual({ x: 10, y: 20 });
  });

  it("opens the menu even with no gesture in progress (cancelActiveGesture is a harmless no-op)", () => {
    const { result } = renderHook(() => useStageContextMenu(PAYLOAD));
    act(() => result.current.onStageContextMenu(fakeMouseEvent(5, 6)));
    expect(result.current.menu).toEqual({ x: 5, y: 6 });
  });

  it("setMenu(null) closes it", () => {
    const { result } = renderHook(() => useStageContextMenu(PAYLOAD));
    act(() => result.current.onStageContextMenu(fakeMouseEvent(5, 6)));
    act(() => result.current.setMenu(null));
    expect(result.current.menu).toBeNull();
  });
});
