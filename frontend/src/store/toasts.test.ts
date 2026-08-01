import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TOAST_ACTION_TTL, TOAST_TTL, toast, useToasts } from "./toasts";

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

describe("toast actions (PLOT_WORKFLOW_PLAN #4)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToasts.setState({ toasts: [] });
  });
  afterEach(() => vi.useRealTimers());

  it("carries no action by default", () => {
    toast("plain");
    expect(useToasts.getState().toasts[0].action).toBeUndefined();
  });

  it("attaches an action label + callback when given one", () => {
    const onClick = vi.fn();
    toast("overlay?", "ok", { action: { label: "Overlay", onClick } });
    const t = useToasts.getState().toasts[0];
    expect(t.action).toEqual({ label: "Overlay", onClick });
  });

  it("uses the default TTL when no ttlMs override is given", () => {
    toast("plain");
    vi.advanceTimersByTime(TOAST_TTL - 10);
    expect(useToasts.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(20);
    expect(useToasts.getState().toasts).toHaveLength(0);
  });

  it("honors a ttlMs override (an action toast outlives the default TTL)", () => {
    toast("overlay?", "ok", { action: { label: "Overlay", onClick: vi.fn() }, ttlMs: TOAST_ACTION_TTL });
    vi.advanceTimersByTime(TOAST_TTL + 10);
    expect(useToasts.getState().toasts).toHaveLength(1); // still here — longer TTL
    vi.advanceTimersByTime(TOAST_ACTION_TTL);
    expect(useToasts.getState().toasts).toHaveLength(0); // gone — the override elapsed
  });
});
