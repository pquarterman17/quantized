import { describe, expect, it } from "vitest";

import { resolveDisplaySeries, resolveSeriesPresentation, withSeriesLegends } from "./figureSpecSeries";
import type { DataStruct } from "./types";

const data: DataStruct = {
  time: [0, 1, 2],
  values: [
    [10, 100, 1, 2],
    [20, 200, 3, 4],
    [30, 300, 5, 6],
  ],
  labels: ["a", "b", "c", "d"],
  units: ["", "V", "A", "V"],
  metadata: {},
};

const view = (over: Partial<Parameters<typeof resolveDisplaySeries>[1]> = {}) => ({
  yKeys: [0, 1, 2, 3] as number[] | null,
  xKey: null as number | null,
  seriesOrder: null as number[] | null,
  hiddenChannels: [] as number[],
  ...over,
});

describe("resolveDisplaySeries", () => {
  it("is plain display order when nothing is hidden or reordered", () => {
    expect(resolveDisplaySeries(data, view())).toEqual({
      displayChannels: [0, 1, 2, 3],
      canvasChannels: [0, 1, 2, 3],
      plotted: [0, 1, 2, 3],
      positions: [0, 1, 2, 3],
    });
  });

  it("keeps the survivors on their UNFILTERED slots when a series is hidden (BUG-015)", () => {
    const { plotted, positions } = resolveDisplaySeries(data, view({ hiddenChannels: [1] }));
    expect(plotted).toEqual([0, 2, 3]);
    // Not [0, 1, 2]: the canvas leaves channel 1 in place with `show:false`.
    expect(positions).toEqual([0, 2, 3]);
  });

  it("follows seriesOrder, and hides AFTER reordering", () => {
    const { displayChannels, plotted, positions } = resolveDisplaySeries(
      data,
      view({ seriesOrder: [3, 1, 0, 2], hiddenChannels: [1] }),
    );
    expect(displayChannels).toEqual([3, 1, 0, 2]);
    expect(plotted).toEqual([3, 0, 2]);
    expect(positions).toEqual([0, 2, 3]);
  });

  it("gives each occurrence of a duplicated channel its own slot (NIT 2)", () => {
    // `indexOf` would collapse both copies of channel 1 onto slot 1, where the
    // canvas (`seriesColor(i, …)`, keyed by array index) paints them 1 and 2.
    const { plotted, positions } = resolveDisplaySeries(data, view({ yKeys: [0, 1, 1, 2] }));
    expect(plotted).toEqual([0, 1, 1, 2]);
    expect(positions).toEqual([0, 1, 2, 3]);
  });

  it("drops the X channel from both lists by default", () => {
    expect(resolveDisplaySeries(data, view({ xKey: 1 }))).toEqual({
      displayChannels: [0, 2, 3],
      // With no `allowExplicitXAsY` the two lists are the same array.
      canvasChannels: [0, 2, 3],
      plotted: [0, 2, 3],
      positions: [0, 1, 2],
    });
  });

  it("keeps an explicit X-as-Y channel but scores positions against the CANVAS list", () => {
    // The canvas' own call always drops the x channel, so its list is [2, 3].
    // Channels 2 and 3 therefore keep slots 0 and 1 — the paints the screen
    // actually used — and channel 1, which the canvas never draws, is parked
    // past the end rather than stealing slot 0 or colliding with channel 2.
    const { displayChannels, canvasChannels, plotted, positions } = resolveDisplaySeries(
      data,
      view({ xKey: 1, yKeys: [1, 2, 3], allowExplicitXAsY: true }),
    );
    expect(displayChannels).toEqual([1, 2, 3]);
    expect(plotted).toEqual([1, 2, 3]);
    expect(positions).toEqual([2, 0, 1]);
    // BUG-013 round 3: the waterfall STEP is measured over this list, so it is
    // returned rather than recomputed by every caller that needs it.
    expect(canvasChannels).toEqual([2, 3]);
  });

  it("parks EVERY canvas-absent channel on its own slot", () => {
    // Two X-as-Y copies must not share one paint either.
    const { positions } = resolveDisplaySeries(
      data,
      view({ xKey: 1, yKeys: [1, 1, 2], allowExplicitXAsY: true }),
    );
    expect(positions).toEqual([1, 2, 0]);
  });
});

describe("withSeriesLegends (BUG-014)", () => {
  it("is the identity when nothing was renamed — including for a null list", () => {
    const styles = [{ color: "#111" }, null];
    expect(withSeriesLegends(styles, [undefined, undefined])).toBe(styles);
    expect(withSeriesLegends(null, [undefined])).toBeNull();
  });

  it("lays a rename over the existing style without displacing it", () => {
    expect(withSeriesLegends([{ color: "#111" }, { width: 2 }], ["Loop 1", undefined])).toEqual([
      { color: "#111", legend: "Loop 1" },
      { width: 2 },
    ]);
  });

  it("materializes a list when there are no styles at all, so a rename still ships", () => {
    expect(withSeriesLegends(null, [undefined, "Loop 2"])).toEqual([null, { legend: "Loop 2" }]);
    expect(withSeriesLegends([], ["Loop 1"])).toEqual([{ legend: "Loop 1" }]);
  });

  it("carries an EMPTY rename verbatim — a blank legend is a real choice", () => {
    expect(withSeriesLegends(null, [""])).toEqual([{ legend: "" }]);
  });

  it("does not mutate the style objects it was handed", () => {
    const styles = [{ color: "#111" }];
    withSeriesLegends(styles, ["Loop 1"]);
    expect(styles[0]).not.toHaveProperty("legend");
  });
});

describe("resolveSeriesPresentation", () => {
  it("derives styles from the view when the document pins none", () => {
    const out = resolveSeriesPresentation([0, 1], { 0: { width: 3 } }, [0, 1], false, [], undefined);
    expect(out?.[0]).toMatchObject({ width: 3 });
  });

  it("deep-copies a pinned publication array rather than sharing it", () => {
    const pinned = [{ color: "#fedcba" }, null];
    const out = resolveSeriesPresentation([0, 1], {}, [0, 1], false, [], pinned);
    expect(out).toEqual(pinned);
    expect(out).not.toBe(pinned);
    expect(out?.[0]).not.toBe(pinned[0]);
  });

  it("omits the field entirely for a null pin with no renames, and materializes one with", () => {
    expect(resolveSeriesPresentation([0], {}, [0], false, [undefined], null)).toBeNull();
    expect(resolveSeriesPresentation([0], {}, [0], false, ["Loop 1"], null)).toEqual([
      { legend: "Loop 1" },
    ]);
  });
});
