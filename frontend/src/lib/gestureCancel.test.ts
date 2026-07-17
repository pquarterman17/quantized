import { beforeEach, describe, expect, it, vi } from "vitest";

import { cancelActiveGesture, setActiveGestureCancel } from "./gestureCancel";

beforeEach(() => {
  setActiveGestureCancel(null);
});

describe("cancelActiveGesture", () => {
  it("is a no-op returning false when nothing is registered", () => {
    expect(cancelActiveGesture()).toBe(false);
  });

  it("invokes and clears a registered canceller, returning true", () => {
    const cancel = vi.fn();
    setActiveGestureCancel(cancel);
    expect(cancelActiveGesture()).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("a second call is a harmless no-op (idempotent within one keypress)", () => {
    const cancel = vi.fn();
    setActiveGestureCancel(cancel);
    expect(cancelActiveGesture()).toBe(true);
    expect(cancelActiveGesture()).toBe(false);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("a fresh registration replaces the previous one without invoking it", () => {
    const first = vi.fn();
    const second = vi.fn();
    setActiveGestureCancel(first);
    setActiveGestureCancel(second);
    expect(cancelActiveGesture()).toBe(true);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
});
