// The live guard (`installExchangeGuard`, lib/exchangeXY.ts): while X and Y are
// exchanged, what the turn cannot draw is REFUSED (the exchange kept) or clears
// the exchange -- never both standing. Run against the real store with its real
// subscribers (the history and window syncs write state while a set is still
// notifying), plus a subscriber of its own that writes synchronously, which is
// what made a guard that compared against the previous state turn the exchange
// off instead of refusing.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { toast, useToasts } from "../store/toasts";
import { useApp } from "../store/useApp";
import { installExchangeGuard } from "./exchangeXY";
import { defaultPlotView } from "./plotview";

const toasts = () => useToasts.getState().toasts.map((t) => t.msg);
const base = { ...defaultPlotView(), composition: null, stageTab: "plot" as const };
const doc = (x: [number, number][]) =>
  ({ plot: { axisBreaks: { x, y: [] }, view: base }, bindings: {} }) as never;
const win = (x: [number, number][]) =>
  [{ id: "w1", kind: "plot", title: "W", datasetId: null, geometry: { x: 0, y: 0, w: 1, h: 1 }, z: 1, winState: "normal", view: base, document: doc(x), bg: "theme", linkGroup: null, pinned: false }] as never;

beforeAll(() => {
  // a second subscriber that writes synchronously while listeners are notified (the real app has several)
  useApp.subscribe((s) => {
    if (s.exchangeXY && s.status === "poke") useApp.setState({ status: "poked" });
  });
  installExchangeGuard(useApp, toast);
  installExchangeGuard(useApp, toast); // idempotent: one subscription, one toast per refusal
});

beforeEach(() => {
  useApp.setState({ ...base, exchangeXY: true, plotWindows: [], focusedWindowId: null, history: [], future: [], status: "" });
  useToasts.setState({ toasts: [] });
});

describe("an edit that adds what the turn cannot draw, while exchanged, is refused up front", () => {
  it("an inset: kept off, the exchange kept, no undo entry, a reason", () => {
    useApp.setState({ status: "poke" }); // a subscriber is writing during the set
    useApp.getState().setInsetMode(true);
    const s = useApp.getState();
    expect(s.insetMode).toBe(false);
    expect(s.exchangeXY).toBe(true);
    expect(s.history).toHaveLength(0);
    expect(toasts().join()).toMatch(/Not applied: insets can't be set while X and Y are exchanged/);
  });

  it("a Y axis break, a Y2 break and a top X axis", () => {
    const s = useApp.getState();
    s.setYFmt({ ...s.yFmt, breaks: [[1, 2]] });
    s.setY2Fmt({ ...s.yFmt, breaks: [[1, 2]] });
    s.setXFmt({ ...s.xFmt, top: { kind: "reciprocal", factor: 1 } });
    const after = useApp.getState();
    expect(after.yFmt.breaks).toBeUndefined();
    expect(after.y2Fmt).toBeNull();
    expect(after.xFmt.top).toBeUndefined();
    expect(after.exchangeXY).toBe(true);
    expect(after.history).toHaveLength(0);
    expect(toasts()).toHaveLength(3);
  });

  it("an ordinary format edit still applies, as one undo step", () => {
    const s = useApp.getState();
    s.setYFmt({ ...s.yFmt, mode: "sci" });
    expect(useApp.getState().yFmt.mode).toBe("sci");
    expect(useApp.getState().history).toHaveLength(1);
    expect(toasts()).toEqual([]);
  });

  it("turning an inset OFF, or any of it when not exchanged, is not refused", () => {
    useApp.setState({ exchangeXY: false });
    useApp.getState().setInsetMode(true);
    expect(useApp.getState().insetMode).toBe(true);
    useApp.setState({ exchangeXY: true, insetMode: true }); // arrives holding both: cleared (below)
    expect(useApp.getState().exchangeXY).toBe(false);
  });
});

describe("what bypasses the setters is put back, only the conflicting fields", () => {
  it("a Y3+ axis added by a direct write", () => {
    useApp.setState({ yAxes: [{ lim: null, scale: null, step: null, fmt: null, label: "R3", color: null }], yAxisOf: { 1: 3 } });
    expect(useApp.getState().yAxes).toEqual([]);
    expect(useApp.getState().yAxisOf).toEqual({});
    expect(useApp.getState().exchangeXY).toBe(true);
    expect(toasts().join()).toMatch(/Y3\+ axes/);
  });

  it("an edit changing digits AND adding a break keeps the digits", () => {
    const s = useApp.getState();
    useApp.setState({ yFmt: { ...s.yFmt, digits: 5, breaks: [[1, 2]] } });
    expect(useApp.getState().yFmt.breaks).toBeUndefined();
    expect(useApp.getState().yFmt.digits).toBe(5);
    expect(useApp.getState().exchangeXY).toBe(true);
  });
});

describe("a mode the exchange does not draw clears it, saying so", () => {
  it.each([
    ["polar", { polarMode: true }, /polar plots/],
    ["statistics", { statMode: true }, /statistics plots/],
    ["stack", { stackMode: true }, /multi-panel layouts/],
    ["facet", { facetKey: 1 }, /multi-panel layouts/],
    ["horizontal bars", { seriesStyles: { 0: { bars: "horizontal" as const } } }, /horizontal bars/],
    ["a saved x-break in the window's document (Break at gaps, the Figure Builder)", { plotWindows: win([[20, 30]]), focusedWindowId: "w1" }, /multi-panel layouts/],
  ])("%s", (_n, patch, msg) => {
    useApp.setState(patch);
    expect(useApp.getState().exchangeXY).toBe(false);
    expect(toasts().join()).toMatch(msg);
    expect(toasts().join()).toMatch(/Exchange X–Y axes turned off/);
  });

  it("a window with no saved break leaves it alone", () => {
    useApp.setState({ plotWindows: win([]), focusedWindowId: "w1" });
    expect(useApp.getState().exchangeXY).toBe(true);
  });
});

describe("what is not an edit leaves the exchange alone", () => {
  it("opening the Map tab", () => {
    useApp.setState({ stageTab: "map" });
    expect(useApp.getState().exchangeXY).toBe(true);
  });
  it("an edit that conflicts with nothing", () => {
    useApp.getState().setShowGrid(false);
    expect(useApp.getState().exchangeXY).toBe(true);
    expect(toasts()).toEqual([]);
  });
});
