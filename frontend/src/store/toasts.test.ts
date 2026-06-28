import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TOAST_TTL, toast, useToasts } from "./toasts";

describe("toasts store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToasts.setState({ toasts: [] });
  });
  afterEach(() => vi.useRealTimers());

  it("pushes a toast with a kind and unique id", () => {
    toast("hello", "ok");
    const { toasts } = useToasts.getState();
    expect(toasts).toHaveLength(1);
    expect(toasts[0].msg).toBe("hello");
    expect(toasts[0].kind).toBe("ok");
  });

  it("defaults kind to info", () => {
    toast("plain");
    expect(useToasts.getState().toasts[0].kind).toBe("info");
  });

  it("auto-dismisses after the TTL", () => {
    toast("bye");
    expect(useToasts.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(TOAST_TTL + 10);
    expect(useToasts.getState().toasts).toHaveLength(0);
  });

  it("caps the queue at 4 (drops the oldest)", () => {
    for (let i = 0; i < 6; i++) toast(`t${i}`);
    const { toasts } = useToasts.getState();
    expect(toasts).toHaveLength(4);
    expect(toasts.map((t) => t.msg)).toEqual(["t2", "t3", "t4", "t5"]);
  });

  it("dismiss removes a specific toast immediately", () => {
    toast("a");
    toast("b");
    const id = useToasts.getState().toasts[0].id;
    useToasts.getState().dismiss(id);
    expect(useToasts.getState().toasts.map((t) => t.msg)).toEqual(["b"]);
  });
});
