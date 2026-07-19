import { describe, expect, it } from "vitest";

import {
  remapChannel,
  remapChannelList,
  remapDatasetChannels,
  remapKeyedRecord,
  remapViewChannels,
  type ViewChannelState,
} from "./channelRemap";
import type { SeriesStyle } from "./types";

const style = (color: string): SeriesStyle => ({ color }) as SeriesStyle;

function view(over: Partial<ViewChannelState> = {}): ViewChannelState {
  return {
    xKey: 0,
    yKeys: [3, 4],
    y2Keys: null,
    hiddenChannels: [],
    seriesOrder: null,
    seriesStyles: {},
    seriesLabels: {},
    errKeys: {},
    ...over,
  };
}

describe("remapChannel", () => {
  it("drops the removed column, shifts later ones down, leaves earlier ones", () => {
    expect(remapChannel(3, 3)).toBeNull();
    expect(remapChannel(4, 3)).toBe(3);
    expect(remapChannel(2, 3)).toBe(2);
  });
});

describe("remapChannelList / remapKeyedRecord", () => {
  it("drops the removed entry and shifts the rest", () => {
    expect(remapChannelList([2, 3, 4, 5], 3)).toEqual([2, 3, 4]);
    expect(remapKeyedRecord({ 2: "a", 3: "b", 4: "c" }, 3)).toEqual({ 2: "a", 3: "c" });
  });

  it("collapses an emptied record to undefined (the store's absent-not-empty rule)", () => {
    expect(remapKeyedRecord({ 3: "only" }, 3)).toBeUndefined();
    expect(remapKeyedRecord(undefined, 3)).toBeUndefined();
  });
});

describe("remapDatasetChannels", () => {
  it("remaps roles/types and drops a filter on the removed column", () => {
    const out = remapDatasetChannels(
      {
        channelRoles: { 3: "x", 4: "y" } as never,
        channelTypes: { 4: "continuous" } as never,
        filter: [
          { col: 3, min: 0, max: 1 },
          { col: 4, min: 0, max: 1 },
        ] as never,
      },
      3,
    );
    expect(out.channelRoles).toEqual({ 3: "y" });
    expect(out.channelTypes).toEqual({ 3: "continuous" });
    expect(out.filter).toEqual([{ col: 3, min: 0, max: 1 }]);
  });
});

describe("remapViewChannels", () => {
  it("shifts a surviving channel's style down with it", () => {
    // The reported bug's core: F2's style was keyed at 4; after F1 (col 3) is
    // removed F2 IS column 3, so its style has to move with it.
    const out = remapViewChannels(view({ seriesStyles: { 4: style("red") } }), 3);
    expect(out.seriesStyles).toEqual({ 3: style("red") });
  });

  it("does not let a stale hidden entry hide the WRONG column", () => {
    // Hiding F1 (col 3) then removing it must not leave [3] behind, which
    // would now mean F2 -- a column the user never asked to hide.
    const out = remapViewChannels(view({ hiddenChannels: [3] }), 3);
    expect(out.hiddenChannels).toEqual([]);
  });

  it("shifts plotted channel lists", () => {
    const out = remapViewChannels(view({ yKeys: [3, 4], y2Keys: [4], seriesOrder: [4, 3] }), 3);
    expect(out.yKeys).toEqual([3]);
    expect(out.y2Keys).toEqual([3]);
    expect(out.seriesOrder).toEqual([3]);
  });

  it("nulls xKey when the removed column WAS the x source", () => {
    // No honest substitute exists; null is the store's own "no explicit x".
    expect(remapViewChannels(view({ xKey: 3 }), 3).xKey).toBeNull();
    expect(remapViewChannels(view({ xKey: 4 }), 3).xKey).toBe(3);
    expect(remapViewChannels(view({ xKey: 0 }), 3).xKey).toBe(0);
  });

  it("remaps errKeys on BOTH sides (keys are Y channels, values are error channels)", () => {
    expect(remapViewChannels(view({ errKeys: { 4: 5 } }), 3).errKeys).toEqual({ 3: 4 });
    // The error channel itself removed -> the pairing is gone.
    expect(remapViewChannels(view({ errKeys: { 4: 3 } }), 3).errKeys).toEqual({});
    // The Y channel itself removed -> likewise.
    expect(remapViewChannels(view({ errKeys: { 3: 4 } }), 3).errKeys).toEqual({});
  });

  it("leaves a view with nothing above the removed column untouched", () => {
    const v = view({ xKey: 0, yKeys: [1, 2], seriesStyles: { 1: style("blue") } });
    const out = remapViewChannels(v, 5);
    expect(out.xKey).toBe(0);
    expect(out.yKeys).toEqual([1, 2]);
    expect(out.seriesStyles).toEqual({ 1: style("blue") });
  });

  it("preserves nulls (an unset list stays unset, not an empty array)", () => {
    const out = remapViewChannels(view({ yKeys: null, y2Keys: null, seriesOrder: null }), 3);
    expect(out.yKeys).toBeNull();
    expect(out.y2Keys).toBeNull();
    expect(out.seriesOrder).toBeNull();
  });
});
