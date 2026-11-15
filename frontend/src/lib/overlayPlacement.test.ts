// The one placement the canvas and the export share (lib/overlayPlacement.ts),
// on a T1,R1,T2,R2 sheet whose T2 is non-monotonic (40, 10, 30, 20).
import { describe, expect, it } from "vitest";

import { R1, R2, t1r1t2r2 } from "../test/ownXFixture";
import { overlayLayout, placeOverlay } from "./overlayPlacement";
import { perSeriesXData } from "./perSeriesX";
import type { Dataset, FitOverlay } from "./types";

const DS = t1r1t2r2();
const layoutFor = (shown: number[], ds: Dataset = DS, xKey: number | null = null) =>
  overlayLayout(ds, xKey, perSeriesXData(ds, xKey, shown)?.blocks);
const BOTH = layoutFor([0, 2]); // blocks [T1 (time), T2 (channel 1)], n = 4
const fit = (over: Partial<FitOverlay> = {}): FitOverlay => ({
  datasetId: "own",
  binding: { yKey: 2, xKey: 1 },
  y: [7, 8, 9, 10],
  ...over,
});
const N = [null, null, null, null];

describe("placeOverlay", () => {
  it("draws an R2 overlay in the T2 block, rows b*n+r, null elsewhere", () => {
    expect(BOTH?.blocks).toEqual([null, 1]);
    expect(placeOverlay(fit(), BOTH)?.y).toEqual([...N, 7, 8, 9, 10]);
  });

  it("draws an R1 overlay in the T1 block", () => {
    const o = placeOverlay(fit({ binding: { yKey: 0, xKey: null }, y: R1 }), BOTH);
    expect(o?.y).toEqual([...R1, ...N]);
  });

  it("spreads a band edge with its curve, and drops a band with a misaligned edge", () => {
    const o = placeOverlay(fit({ band: [{ label: "lo", y: [6, 7, 8, 9], legend: "95% band" }] }), BOTH);
    expect(o?.band).toEqual([{ label: "lo", legend: "95% band", y: [...N, 6, 7, 8, 9] }]);
    expect(placeOverlay(fit({ band: [{ label: "lo", y: [1] }] }), BOTH)?.band).toBeUndefined();
  });

  it("does not draw an overlay whose X has no block (all of T2's curves hidden)", () => {
    // R2 hidden: the view collapses to T1 alone; R2's fit belongs to T2.
    const collapsed = layoutFor([0]);
    expect(collapsed?.blocks).toEqual([null]);
    expect(placeOverlay(fit(), collapsed)).toBeNull();
    // ... while R1's own overlay there is untouched (the very same object).
    const r1 = fit({ binding: { yKey: 0, xKey: null }, y: R1 });
    expect(placeOverlay(r1, collapsed)).toBe(r1);
  });

  it("does not draw an overlay whose Y no longer sits on its bound X", () => {
    // Re-designated: R1 is now the X and T2 a Y, so R2 belongs to channel 0 --
    // a fit made against T2 describes no curve of this view.
    const ds: Dataset = { ...DS, columnDesignations: { 0: "X", 1: "Y" } };
    const layout = overlayLayout(ds, null, perSeriesXData(ds, null, [1, 2])?.blocks);
    expect(layout?.blocks).toEqual([0]);
    expect(placeOverlay(fit(), layout)).toBeNull();
  });

  it("draws an overlay of a channel that is not a curve (T2 plotted as a Y) on the plot's X", () => {
    // R2 hidden, T2 shown as a Y: the view is T1 alone and T2's column is drawn against it.
    const collapsed = layoutFor([0, 1]);
    const o = fit({ binding: { yKey: 1, xKey: null } });
    expect(placeOverlay(o, collapsed)).toBe(o);
    // With both X blocks shown, it sits in the shared (T1) block.
    expect(placeOverlay(o, layoutFor([0, 1, 2]))?.y).toEqual([7, 8, 9, 10, ...N]);
  });

  it("does not draw another dataset's overlay, or one of the wrong length", () => {
    expect(placeOverlay(fit({ datasetId: "other" }), BOTH)).toBeNull();
    expect(placeOverlay(fit({ y: [1, 2, 3] }), BOTH)).toBeNull();
  });

  it("fails closed for a binding to no curve (yKey -1) on a multi-X view, passes through on one X", () => {
    const orphan = fit({ binding: { yKey: -1, xKey: null }, y: R1 });
    expect(placeOverlay(orphan, BOTH)).toBeNull();
    expect(placeOverlay(orphan, layoutFor([0]))).toBe(orphan);
    expect(placeOverlay(orphan, null)).toBe(orphan);
  });

  it("never guesses an unbound (legacy) overlay into a block, but keeps it on a one-X view", () => {
    const legacy = { datasetId: "own", y: R2 } as unknown as FitOverlay;
    expect(placeOverlay(legacy, BOTH)).toBeNull();
    expect(placeOverlay(legacy, layoutFor([0]))).toBe(legacy);
  });

  it("passes every overlay through untouched on a sheet with one X", () => {
    const single: Dataset = { ...DS, columnDesignations: {} };
    expect(overlayLayout(single, null, perSeriesXData(single, null, [0, 2])?.blocks)).toBeNull();
    const o = fit();
    expect(placeOverlay(o, null)).toBe(o);
    const legacy = { datasetId: "own", y: R2 } as unknown as FitOverlay;
    expect(placeOverlay(legacy, null)).toBe(legacy);
  });

  it("returns the SAME placed object for the same overlay and block layout", () => {
    const o = fit();
    const first = placeOverlay(o, BOTH);
    // A rename mints a new dataset object over the same data: same layout key.
    const renamedDs: Dataset = { ...DS, name: "renamed" };
    const renamed = overlayLayout(renamedDs, null, BOTH!.blocks);
    expect(placeOverlay(o, renamed)).toBe(first);
  });
});
