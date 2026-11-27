// Dendrogram screen == export, pinned by the shared wire fixture
// `tests/fixtures/wire/dendrogram.json`. The Python half
// (`tests/test_dendrogram_wire.py`) asserts the backend geometry and the
// matplotlib artists against the same `draw` list; this half asserts the
// canvas draw list built from the same geometry.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ABOVE_CUT, PALETTE, dendrogramDrawList } from "./dendrogramModel";

const FIX = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..", "..", "tests", "fixtures", "wire", "dendrogram.json"),
    "utf8",
  ),
);

describe("dendrogram wire fixture", () => {
  it("pins the palette", () => {
    expect([...PALETTE]).toEqual(FIX.draw.palette);
    expect(ABOVE_CUT).toBe(FIX.draw.above_cut);
  });

  it("builds the fixture draw list from the fixture geometry", () => {
    const d = dendrogramDrawList(FIX.geometry);
    expect(d.links).toHaveLength(FIX.draw.links.length);
    d.links.forEach((l, i) => {
      const e = FIX.draw.links[i];
      expect(l.color).toBe(e.color);
      l.x.forEach((v: number, j: number) => expect(v).toBeCloseTo(e.x[j], 12));
      l.y.forEach((v: number, j: number) => expect(v).toBeCloseTo(e.y[j], 12));
    });
    expect(d.leaves).toEqual(FIX.draw.leaves);
    expect(d.cutY).toBeCloseTo(FIX.draw.cut_y, 12);
    expect(d.xRange).toEqual(FIX.draw.x_range);
    expect(d.yRange[0]).toBe(FIX.draw.y_range[0]);
    expect(d.yRange[1]).toBeCloseTo(FIX.draw.y_range[1], 12);
    expect(d.leafOrder).toEqual(FIX.draw.leaf_order);
  });

  it("colours links above the cut grey and links inside a cluster by cluster", () => {
    const d = dendrogramDrawList(FIX.geometry);
    const colors = d.links.map((l) => l.color);
    expect(colors.filter((c) => c === ABOVE_CUT)).toHaveLength(2);
    expect(new Set(d.leaves.map((l) => l.color)).size).toBe(3);
  });
});
