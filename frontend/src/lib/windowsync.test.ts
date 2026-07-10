// lib/windowsync — the cross-window link-group registry + x-range sync hook
// (MULTI_PLOT_PLAN item 13). jsdom can't render a real uPlot canvas, so the
// "plots" here are minimal fakes carrying exactly what the hook reads
// (`scales.x` + `setScale`) — the sync CONTRACT is what's under test:
// propagation to same-group members only, the per-group re-entrancy guard,
// and unregister-on-destroy cleanup.

import { describe, expect, it, vi } from "vitest";
import type uPlot from "uplot";

import { registerSyncPlot, windowSyncKey, windowXSyncHook } from "./windowsync";

/** A fake uPlot carrying only what the hook touches. */
function fakePlot(min: number | null = 0, max: number | null = 10) {
  return {
    scales: { x: { min, max } },
    setScale: vi.fn(),
  } as unknown as uPlot & { setScale: ReturnType<typeof vi.fn> };
}

describe("windowSyncKey", () => {
  it("maps group n to 'qz-win-link-<n>' and null/undefined to undefined (unlinked)", () => {
    expect(windowSyncKey(1)).toBe("qz-win-link-1");
    expect(windowSyncKey(3)).toBe("qz-win-link-3");
    expect(windowSyncKey(null)).toBeUndefined();
    expect(windowSyncKey(undefined)).toBeUndefined();
  });
});

describe("windowXSyncHook + registerSyncPlot", () => {
  it("propagates an x-range to every OTHER registered member of the same group", () => {
    const a = fakePlot(2, 5);
    const b = fakePlot();
    const c = fakePlot();
    const un = [registerSyncPlot("g1", a), registerSyncPlot("g1", b), registerSyncPlot("g1", c)];

    windowXSyncHook("g1")(a, "x");
    expect(a.setScale).not.toHaveBeenCalled(); // never itself
    expect(b.setScale).toHaveBeenCalledWith("x", { min: 2, max: 5 });
    expect(c.setScale).toHaveBeenCalledWith("x", { min: 2, max: 5 });

    un.forEach((u) => u());
  });

  it("does NOT propagate across different groups", () => {
    const a = fakePlot(1, 2);
    const other = fakePlot();
    const unA = registerSyncPlot("g1", a);
    const unOther = registerSyncPlot("g2", other);

    windowXSyncHook("g1")(a, "x");
    expect(other.setScale).not.toHaveBeenCalled();

    unA();
    unOther();
  });

  it("ignores non-x scale changes and null (unranged) x scales", () => {
    const a = fakePlot(1, 2);
    const b = fakePlot();
    const un = [registerSyncPlot("g1", a), registerSyncPlot("g1", b)];

    windowXSyncHook("g1")(a, "y");
    expect(b.setScale).not.toHaveBeenCalled();

    const empty = fakePlot(null, null);
    const unEmpty = registerSyncPlot("g1", empty);
    windowXSyncHook("g1")(empty, "x");
    expect(b.setScale).not.toHaveBeenCalled();

    un.forEach((u) => u());
    unEmpty();
  });

  it("guards re-entrancy at the GROUP level — a propagated setScale that re-fires a member's own hook never bounces back", () => {
    // Each window builds its OWN hook instance (unlike multipanel's single
    // shared closure), so the guard must be shared per group: simulate the
    // real uPlot behaviour where b.setScale re-fires b's own setScale hook.
    const a = fakePlot(2, 5);
    const b = fakePlot(0, 10);
    const hookA = windowXSyncHook("g1");
    const hookB = windowXSyncHook("g1");
    const un = [registerSyncPlot("g1", a), registerSyncPlot("g1", b)];
    (b.setScale as ReturnType<typeof vi.fn>).mockImplementation(() => hookB(b, "x"));

    hookA(a, "x"); // would loop forever without the group-level guard
    expect(b.setScale).toHaveBeenCalledTimes(1);
    expect(a.setScale).not.toHaveBeenCalled(); // b's re-fired hook was guarded out

    un.forEach((u) => u());
  });

  it("unregister removes a plot from its group; an emptied group stops propagating entirely", () => {
    const a = fakePlot(2, 5);
    const b = fakePlot();
    const unA = registerSyncPlot("g1", a);
    const unB = registerSyncPlot("g1", b);

    unB();
    windowXSyncHook("g1")(a, "x");
    expect(b.setScale).not.toHaveBeenCalled();

    unA();
    // Group is now gone from the registry — the hook is a silent no-op.
    expect(() => windowXSyncHook("g1")(a, "x")).not.toThrow();
  });
});
