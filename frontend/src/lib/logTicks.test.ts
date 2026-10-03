import type uPlot from "uplot";
import { describe, expect, it } from "vitest";

import { logDecadeLabels, logGridSplits, logMajorTickFilter } from "./logTicks";
import { fixedLogAxisSplits } from "./uplotOpts";

/** A uPlot stand-in whose y axis (index 1, 30 px label spacing) spends
 *  `pxPerDecade` pixels per decade. */
const plotWith = (pxPerDecade: number) =>
  ({ axes: [{ scale: "x" }, { scale: "y" }], valToPos: (v: number) => -Math.log10(v) * pxPerDecade }) as unknown as uPlot;

const labelled = (out: (number | null)[]) => out.filter((v): v is number => v != null);

describe("logMajorTickFilter keeps decade labels apart", () => {
  // A SIMS depth profile spans ~25 decades; in a short window each decade gets
  // a few pixels, and labelling every one stacked the labels on each other.
  const splits = fixedLogAxisSplits(1e-2, 1e23);

  it("labels every decade when each one has room", () => {
    expect(labelled(logMajorTickFilter(plotWith(40), splits, 1))).toHaveLength(26);
  });

  it("thins to every n-th decade, anchored on 10^0, when they would crowd", () => {
    const kept = labelled(logMajorTickFilter(plotWith(10), splits, 1));
    expect(kept.map((v) => Math.round(Math.log10(v)))).toEqual([0, 3, 6, 9, 12, 15, 18, 21]);
  });

  it("gives the x axis uPlot's wider 50 px label spacing", () => {
    const kept = labelled(logMajorTickFilter(plotWith(40), splits, 0));
    expect(kept.map((v) => Math.round(Math.log10(v)))).toEqual([-2, 0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]);
  });

  it("keeps the split array aligned for grid and tick marks", () => {
    expect(logMajorTickFilter(plotWith(10), splits, 1)).toHaveLength(splits.length);
  });
});

describe("logDecadeLabels on a sub-decade view", () => {
  // A stacked SIMS panel ranged 1e22..3e22 printed "10,000,000,000,000,000,000,000",
  // widening that panel's y gutter so the stacked plot areas no longer lined up.
  it("writes huge magnitudes as mantissa x 10^k", () => {
    expect(logDecadeLabels([1e22, 1.5e22, 2e22, 2.5e22, 3e22])).toEqual([
      "10²²",
      "1.5×10²²",
      "2×10²²",
      "2.5×10²²",
      "3×10²²",
    ]);
  });

  it("writes tiny magnitudes the same way, per value's own decade", () => {
    expect(logDecadeLabels([6e-6, 8e-6, 1e-5, 1.2e-5])).toEqual(["6×10⁻⁶", "8×10⁻⁶", "10⁻⁵", "1.2×10⁻⁵"]);
  });

  it("leaves ordinary magnitudes to the plain numeric labels", () => {
    expect(logDecadeLabels([0.8, 0.9, 1, 1.1])).toBeNull();
    expect(logDecadeLabels([2000, 4000, 6000, 8000])).toBeNull();
  });
});

describe("logGridSplits drops the 2-9 minors on a crowded decade axis", () => {
  const isDecade = (v: number) => Math.abs(Math.log10(v) - Math.round(Math.log10(v))) < 1e-9;
  const decades = (splits: number[]) => splits.filter(isDecade);

  it("keeps every minor on a roomy span of up to six decades", () => {
    const splits = fixedLogAxisSplits(2e-7, 0.1); // a PNR reflectivity curve
    expect(logGridSplits(plotWith(80), 1, splits)).toEqual(splits);
  });

  it("drops them past six decades even when every label fits", () => {
    const splits = fixedLogAxisSplits(1e15, 1e23); // a SIMS depth profile
    expect(logGridSplits(plotWith(40), 1, splits)).toEqual(decades(splits));
  });

  it("drops them whenever the decade labels are thinned", () => {
    const splits = fixedLogAxisSplits(1e-3, 1e2);
    expect(logGridSplits(plotWith(80), 1, splits)).toEqual(splits);
    expect(logGridSplits(plotWith(20), 1, splits)).toEqual(decades(splits));
  });

  it("leaves a sub-decade axis' arithmetic ticks alone", () => {
    const splits = fixedLogAxisSplits(0.7, 1.3, 0.1);
    expect(logGridSplits(plotWith(5), 1, splits)).toEqual(splits);
  });
});

describe("logMajorTickFilter on a sub-decade view keeps labels apart", () => {
  // 2e-7..1.5e-6 by 1e-7: on a log axis the top ticks bunch together.
  const splits = fixedLogAxisSplits(2e-7, 1.5e-6, 1e-7);

  it("labels every arithmetic tick when they have room", () => {
    expect(logMajorTickFilter(plotWith(4000), splits, 1)).toEqual(splits);
  });

  it("drops a label closer than the minimum spacing to the last one kept", () => {
    const u = plotWith(200);
    const out = logMajorTickFilter(u, splits, 1);
    expect(out).toHaveLength(splits.length);
    const kept = labelled(out);
    expect(kept.length).toBeLessThan(splits.length);
    expect(kept[0]).toBe(splits[0]);
    const pos = kept.map((v) => u.valToPos(v, "y"));
    for (let i = 1; i < pos.length; i++) expect(Math.abs(pos[i] - pos[i - 1])).toBeGreaterThanOrEqual(30);
  });
});
