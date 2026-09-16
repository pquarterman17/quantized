// P3.3: what a snapshot FREEZES. `lib/plotsnapshot.ts` and this hook both
// promise the snapshot command "freezes exactly what's on screen", and the first
// cut of the cycle broke that promise: the bundle carried the RAW stored styles
// and no cycle, so a snapshot taken of a dashed plot rendered solid — and worse,
// changed retroactively the moment the preference was turned off. The fix is to
// resolve the styles HERE, at freeze time, so the dashes are frozen with the
// data. (`SnapshotPlotWindow.test.tsx` carries the other half: such a bundle
// renders its dashes with the preference OFF.)

import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useLiveSnapshotPublish, type LiveSnapshotArgs } from "./useLiveSnapshotPublish";
import { publishLivePlotSnapshot, readLivePlotSnapshot } from "../../lib/plotsnapshot";
import { publishLiveWaterfallSpan, readLiveWaterfallSpan } from "../../lib/waterfallOffset";
import { displayPositions } from "../../lib/seriesStyleCycle";
import type { PlotPayload } from "../../lib/plotdata";
import type { SeriesStyle } from "../../lib/types";

afterEach(() => {
  publishLivePlotSnapshot(null);
  publishLiveWaterfallSpan(null);
});

const payload: PlotPayload = {
  data: [
    [0, 1, 2],
    [10, 20, 30],
    [1, 2, 3],
  ] as PlotPayload["data"],
  series: [
    { label: "A", unit: "" },
    { label: "B", unit: "" },
  ],
  xLabel: "x",
  xUnit: "",
};

const args = (
  styleList: (SeriesStyle | undefined)[] | undefined,
  seriesCycle: LiveSnapshotArgs["seriesCycle"],
): LiveSnapshotArgs => ({
  active: { id: "d1", name: "d", data: { time: [], values: [], labels: [], units: [], metadata: {} } },
  polarMode: false,
  statMode: false,
  stackMode: false,
  plottedCount: 2,
  composition: null,
  payload,
  displayPayload: payload,
  styleList,
  labelList: [undefined, undefined],
  errorBars: new Map(),
  plotted: [0, 1],
  colorByColumns: new Map(),
  hidden: undefined,
  seriesCycle,
});

describe("useLiveSnapshotPublish — the cycle is RESOLVED into the frozen bundle", () => {
  it("with a cycle, the published styles carry the resolved dash and glyph", () => {
    renderHook(() => useLiveSnapshotPublish(args([undefined, undefined], displayPositions(true, 2))));
    const published = readLivePlotSnapshot();
    expect(published?.styleList).toEqual([
      { line: "solid", markerShape: "circle" },
      { line: "dashed", markerShape: "square" },
    ]);
  });

  it("an explicit style still wins, and is not otherwise rewritten", () => {
    const stored: (SeriesStyle | undefined)[] = [{ line: "dotted", color: "#f00" }, { marker: true }];
    renderHook(() => useLiveSnapshotPublish(args(stored, displayPositions(true, 2))));
    expect(readLivePlotSnapshot()?.styleList).toEqual([
      { line: "dotted", color: "#f00", markerShape: "circle" },
      { marker: true, line: "dashed", markerShape: "square" },
    ]);
  });

  it("with NO cycle the published list is the caller's OWN array — byte-identical", () => {
    // The identity path matters twice over: the frozen bundle must be what it
    // was before the feature, and a fresh array every render would re-publish
    // (and so re-freeze) on every paint.
    const stored: (SeriesStyle | undefined)[] = [{ color: "#f00" }, undefined];
    renderHook(() => useLiveSnapshotPublish(args(stored, null)));
    expect(readLivePlotSnapshot()?.styleList).toBe(stored);
  });

  it("publishes nothing at all while an alternate render mode is showing", () => {
    // Unchanged behaviour — the XY bundle is not what is on screen then.
    renderHook(() =>
      useLiveSnapshotPublish({ ...args([undefined, undefined], displayPositions(true, 2)), polarMode: true }),
    );
    expect(readLivePlotSnapshot()).toBeNull();
    // BUG-013 review round: the waterfall span rides the SAME gate, so an
    // export taken while polar/stat/stacked is showing cannot pick up a span
    // measured for a canvas that is not on screen.
    expect(readLiveWaterfallSpan("d1")).toBeNull();
  });
});

// BUG-013 review round. The span the export reads back must be measured from
// the RAW fetched payload — the rows the canvas' own `applyWaterfall` scanned —
// and must be keyed by the dataset it came from.
describe("useLiveSnapshotPublish — the live waterfall span", () => {
  it("publishes the y-span of the raw payload's value columns, keyed by dataset", () => {
    renderHook(() => useLiveSnapshotPublish(args([undefined, undefined], null)));
    // Value columns are [10,20,30] and [1,2,3] -> combined range 30 - 1 = 29.
    expect(readLiveWaterfallSpan("d1")).toBeCloseTo(29, 12);
  });

  it("is refused for a DIFFERENT dataset — the refocus race must not cross spans", () => {
    renderHook(() => useLiveSnapshotPublish(args([undefined, undefined], null)));
    expect(readLiveWaterfallSpan("d2")).toBeNull();
  });

  it("is measured BEFORE the waterfall is applied, not from the composed payload", () => {
    // The composed payload the snapshot bundle carries is already staggered, so
    // measuring THAT would feed the export a span that grows with the stagger.
    // Hand the hook a `displayPayload` whose second column is shifted far past
    // the raw one and check the published span still describes the RAW rows.
    const composed: PlotPayload = {
      ...payload,
      data: [
        [0, 1, 2],
        [10, 20, 30],
        [1001, 1002, 1003],
      ] as PlotPayload["data"],
    };
    renderHook(() =>
      useLiveSnapshotPublish({ ...args([undefined, undefined], null), displayPayload: composed }),
    );
    expect(readLiveWaterfallSpan("d1")).toBeCloseTo(29, 12);
  });

  it("clears on unmount, so a closed Plot tab leaves no stale span behind", () => {
    const { unmount } = renderHook(() => useLiveSnapshotPublish(args([undefined, undefined], null)));
    expect(readLiveWaterfallSpan("d1")).toBeCloseTo(29, 12);
    unmount();
    expect(readLiveWaterfallSpan("d1")).toBeNull();
  });
});
