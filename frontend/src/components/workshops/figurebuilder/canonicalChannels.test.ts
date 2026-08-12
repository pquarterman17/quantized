import { describe, expect, it } from "vitest";

import {
  resolvedYKeys,
  toggleChannelPlotted,
  toggleChannelSecondary,
  type ChannelMembership,
} from "./canonicalChannels";

describe("resolvedYKeys", () => {
  it("returns yKeys verbatim (a copy) when set", () => {
    const yKeys = [0, 2];
    expect(resolvedYKeys(yKeys, [0, 1, 2])).toEqual([0, 2]);
    expect(resolvedYKeys(yKeys, [0, 1, 2])).not.toBe(yKeys);
  });

  it("falls back to the dense default when yKeys is the auto sentinel (null)", () => {
    expect(resolvedYKeys(null, [1, 2])).toEqual([1, 2]);
  });
});

describe("toggleChannelPlotted", () => {
  const membership = (patch: Partial<ChannelMembership> = {}): ChannelMembership => ({
    xKey: null,
    yKeys: [0, 1],
    y2Keys: null,
    ...patch,
  });

  it("adds an unselected channel to yKeys, sorted", () => {
    const next = toggleChannelPlotted(membership({ yKeys: [1] }), 0, [0, 1]);
    expect(next.yKeys).toEqual([0, 1]);
  });

  it("removes a selected channel from yKeys", () => {
    const next = toggleChannelPlotted(membership(), 0, [0, 1]);
    expect(next.yKeys).toEqual([1]);
  });

  it("resolves the auto sentinel (yKeys=null) against the caller's fallback before toggling", () => {
    const next = toggleChannelPlotted(membership({ yKeys: null }), 2, [0, 1]);
    expect(next.yKeys).toEqual([0, 1, 2]);
  });

  it("is a no-op (same reference) when unchecking would leave nothing plotted besides X", () => {
    const m = membership({ yKeys: [0], xKey: null });
    const next = toggleChannelPlotted(m, 0, [0]);
    expect(next).toBe(m);
  });

  it("is also a no-op when the only remaining entry is a stale xKey left over in yKeys", () => {
    // Defensive mirror of ChannelsCard's `next.filter((x) => x !== xKey)` --
    // xKey never counts toward "something is still plotted", even when it
    // lingers in yKeys from a channel reassignment that didn't clean it up.
    const m = membership({ yKeys: [0, 3], xKey: 3 });
    const next = toggleChannelPlotted(m, 0, [0]);
    expect(next).toBe(m);
  });

  it("drops a removed channel from y2Keys too -- a hidden channel can't ride the secondary axis", () => {
    const m = membership({ yKeys: [0, 1], y2Keys: [1] });
    const next = toggleChannelPlotted(m, 1, [0, 1]);
    expect(next.yKeys).toEqual([0]);
    expect(next.y2Keys).toBeNull();
  });

  it("keeps y2Keys untouched when the removed channel wasn't on it", () => {
    const m = membership({ yKeys: [0, 1, 2], y2Keys: [2] });
    const next = toggleChannelPlotted(m, 1, [0, 1, 2]);
    expect(next.yKeys).toEqual([0, 2]);
    expect(next.y2Keys).toEqual([2]);
  });

  it("leaves every other field (xKey) untouched", () => {
    const next = toggleChannelPlotted(membership({ xKey: 5 }), 0, [0, 1]);
    expect(next.xKey).toBe(5);
  });
});

describe("toggleChannelSecondary", () => {
  const membership = (patch: Partial<ChannelMembership> = {}): ChannelMembership => ({
    xKey: null,
    yKeys: [0, 1, 2],
    y2Keys: null,
    ...patch,
  });

  it("promotes a plotted channel onto y2Keys, sorted", () => {
    const next = toggleChannelSecondary(membership({ y2Keys: [2] }), 0, [0, 1, 2]);
    expect(next.y2Keys).toEqual([0, 2]);
  });

  it("demotes a channel already on y2Keys back to primary", () => {
    const next = toggleChannelSecondary(membership({ y2Keys: [1] }), 1, [0, 1, 2]);
    expect(next.y2Keys).toBeNull();
  });

  it("is a no-op when the channel is not already plotted on Y", () => {
    const m = membership({ yKeys: [0, 1] });
    const next = toggleChannelSecondary(m, 2, [0, 1]);
    expect(next).toBe(m);
  });

  it("is a no-op when promoting would leave no OTHER channel on the primary axis", () => {
    const m = membership({ yKeys: [0], y2Keys: null });
    const next = toggleChannelSecondary(m, 0, [0]);
    expect(next).toBe(m);
  });

  it("allows promoting when at least one other channel stays primary", () => {
    const m = membership({ yKeys: [0, 1], y2Keys: null });
    const next = toggleChannelSecondary(m, 0, [0, 1]);
    expect(next.y2Keys).toEqual([0]);
  });

  it("resolves the auto sentinel (yKeys=null) against the caller's fallback", () => {
    const next = toggleChannelSecondary(membership({ yKeys: null }), 0, [0, 1, 2]);
    expect(next.y2Keys).toEqual([0]);
  });

  it("leaves yKeys untouched", () => {
    const next = toggleChannelSecondary(membership({ y2Keys: null }), 0, [0, 1, 2]);
    expect(next.yKeys).toEqual([0, 1, 2]);
  });
});
