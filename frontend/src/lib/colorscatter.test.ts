import { describe, expect, it } from "vitest";

import {
  buildColorByColumns,
  colorScaleLegendEntries,
  colorScatterFill,
  paintColorPoint,
  type ColorScatterSpec,
} from "./colorscatter";
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

  it("collapses identical scales to one key and prefers a spec's own label (P1.4 gradient)", () => {
    const spec: ColorScatterSpec = { channel: 1, z: [100], colormap: "viridis", lo: 100, hi: 400, label: "T (K)" };
    const columns = new Map([[1, spec], [2, { ...spec, shape: "square" as const }]]);
    expect(colorScaleLegendEntries(ds, columns)).toEqual([{ label: "T (K)", colormap: "viridis", lo: 100, hi: 400 }]);
    // A different range is a different key.
    columns.set(3, { ...spec, hi: 500 });
    expect(colorScaleLegendEntries(ds, columns)).toHaveLength(2);
  });
});

describe("colorScatterFill / paintColorPoint — the one colour rule (P1.4 gradient shares it)", () => {
  const spec: ColorScatterSpec = { channel: 2, z: [0, 5, 10, null, -3, 99], colormap: "viridis", lo: 0, hi: 10 };

  it("normalizes over [lo, hi], clamps outside it, and draws nothing for a missing value", () => {
    expect(colorScatterFill(spec, 0)).toBe("rgb(68, 1, 84)"); // viridis' first stop
    expect(colorScatterFill(spec, 2)).toBe("rgb(253, 231, 37)"); // its last
    expect(colorScatterFill(spec, 1)).toBe("rgb(33, 144, 141)"); // the middle stop
    expect(colorScatterFill(spec, 3)).toBeNull();
    expect(colorScatterFill(spec, 4)).toBe("rgb(68, 1, 84)");
    expect(colorScatterFill(spec, 5)).toBe("rgb(253, 231, 37)");
    expect(colorScatterFill({ ...spec, hi: 0 }, 1)).toBe("rgb(68, 1, 84)"); // degenerate range reads 0
  });

  it("paints a circle by default and a glyph when asked — filled or stroked", () => {
    const calls: string[] = [];
    const ctx = new Proxy({} as CanvasRenderingContext2D, {
      get: (_t, k: string) => (k === "fillStyle" || k === "strokeStyle" ? "" : () => calls.push(k)),
      set: () => true,
    });
    paintColorPoint(ctx, 5, 5, 2, "rgb(1, 2, 3)");
    expect(calls).toEqual(["beginPath", "arc", "fill"]);
    calls.length = 0;
    paintColorPoint(ctx, 5, 5, 2, "rgb(1, 2, 3)", "square");
    // The square's four corners, closed and filled — no circle.
    expect(calls).toEqual(["beginPath", "moveTo", "lineTo", "lineTo", "lineTo", "closePath", "fill"]);
    calls.length = 0;
    paintColorPoint(ctx, 5, 5, 2, "rgb(1, 2, 3)", "plus");
    expect(calls).toContain("lineTo");
    expect(calls.at(-1)).toBe("stroke");
  });
});
