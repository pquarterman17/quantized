import { describe, expect, it } from "vitest";

import { buildColorByColumns, colorScaleLegendEntries } from "./colorscatter";
import type { DataStruct, SeriesStyle } from "./types";

const ds: DataStruct = {
  time: [0, 1, 2, 3],
  values: [
    [10, 100, 0.1],
    [20, 200, 0.5],
    [30, 300, NaN],
    [40, 400, 0.9],
  ],
  labels: ["M", "T", "z"],
  units: ["emu", "K", ""],
  metadata: {},
};

describe("buildColorByColumns", () => {
  it("keys the spec by display column (p+1) for a series with colorBy set", () => {
    const styles: Record<number, SeriesStyle> = { 0: { colorBy: 2 } };
    const m = buildColorByColumns(ds, [0, 1], styles);
    expect([...m.keys()]).toEqual([1]);
    const spec = m.get(1)!;
    expect(spec.channel).toBe(2);
    expect(spec.z).toEqual([0.1, 0.5, null, 0.9]); // NaN -> null
    expect(spec.lo).toBe(0.1);
    expect(spec.hi).toBe(0.9);
    expect(spec.colormap).toBe("viridis"); // default
  });

  it("respects an explicit colormap override", () => {
    const styles: Record<number, SeriesStyle> = { 1: { colorBy: 0, colormap: "magma" } };
    const m = buildColorByColumns(ds, [1], styles);
    expect(m.get(1)!.colormap).toBe("magma");
  });

  it("returns an empty map when no channel requests colorBy", () => {
    expect(buildColorByColumns(ds, [0, 1], {}).size).toBe(0);
  });

  it("skips a colorBy channel with no finite values anywhere", () => {
    const allNaN: DataStruct = { ...ds, values: ds.values.map((row) => [row[0], row[1], NaN]) };
    const styles: Record<number, SeriesStyle> = { 0: { colorBy: 2 } };
    expect(buildColorByColumns(allNaN, [0], styles).size).toBe(0);
  });

  it("respects plotted display order when assigning columns", () => {
    const styles: Record<number, SeriesStyle> = { 1: { colorBy: 2 } };
    // T (ch 1) plotted second -> display column 2.
    const m = buildColorByColumns(ds, [0, 1], styles);
    expect([...m.keys()]).toEqual([2]);
  });
});

describe("colorScaleLegendEntries", () => {
  it("resolves the source channel's own label for each entry", () => {
    const styles: Record<number, SeriesStyle> = { 0: { colorBy: 2, colormap: "gray" } };
    const columns = buildColorByColumns(ds, [0], styles);
    const entries = colorScaleLegendEntries(ds, columns);
    expect(entries).toEqual([{ label: "z", colormap: "gray", lo: 0.1, hi: 0.9 }]);
  });

  it("returns an empty array for an empty columns map", () => {
    expect(colorScaleLegendEntries(ds, new Map())).toEqual([]);
  });
});
