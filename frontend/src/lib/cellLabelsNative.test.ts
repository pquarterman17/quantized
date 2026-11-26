// The measured-cell labels, against the table the export asserts too
// (tests/fixtures/wire/annotation_measures.json `cell_native`,
// tests/test_cell_labels_native.py), and the lattice read off a scan's rows.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { nativeCellGrid, nativeCellSpots, type CellLabelSpot } from "./cellLabelsNative";
import type { CellLabelFormat } from "./cellLabels";

interface Case {
  name: string;
  x: number[];
  y: number[];
  values: (number | null)[][];
  frame: [number, number, number, number];
  size: [number, number];
  font: number;
  format: CellLabelFormat;
  precision: number;
  spots: CellLabelSpot[];
}

interface JitterCase extends Omit<Case, "x" | "y" | "values"> {
  rows: number[][];
  x: number[] | null;
  y: number[] | null;
  values: (number | null)[][] | null;
}

const WIRE = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "fixtures", "wire", "annotation_measures.json"), "utf8"),
);
export const NATIVE_CASES: Case[] = WIRE.cell_native;
const JITTER_CASES: JitterCase[] = WIRE.cell_jitter;

describe("nativeCellSpots", () => {
  it.each(NATIVE_CASES)("$name", (c) => {
    const got = nativeCellSpots({ xAxis: c.x, yAxis: c.y, values: c.values }, c.frame, c.size, { format: c.format, precision: c.precision }, c.font);
    expect(got.map(({ i, j, text }) => ({ i, j, text }))).toEqual(c.spots.map(({ i, j, text }) => ({ i, j, text })));
    got.forEach((g, k) => {
      expect(g.x).toBeCloseTo(c.spots[k].x, 9);
      expect(g.y).toBeCloseTo(c.spots[k].y, 9);
    });
  });
});

describe("nativeCellGrid", () => {
  it("reads a full scan's lattice, however the rows are ordered", () => {
    const pts: number[][] = [];
    for (let j = 5; j >= 0; j--) for (let i = 0; i < 6; i++) pts.push([i * 2, j * 2, 10 * j + i]);
    const g = nativeCellGrid(pts, [0, 1, 2]);
    expect(g?.xAxis).toEqual([0, 2, 4, 6, 8, 10]);
    expect(g?.yAxis).toEqual([0, 2, 4, 6, 8, 10]);
    expect(g?.values[3][4]).toBe(34);
  });
  it("leaves a missing cell as a gap and averages repeated rows", () => {
    const g = nativeCellGrid([[0, 0, 1], [1, 0, 2], [0, 1, 3], [0, 1, 5], [1, 1, NaN]], [0, 1, 2]);
    expect(g?.values).toEqual([[1, 2], [4, null]]);
  });
  it("is not a lattice for scattered points or a line scan", () => {
    const scattered = Array.from({ length: 50 }, (_, k) => [Math.sin(k) * 7, Math.cos(k * 1.3) * 5, k]);
    expect(nativeCellGrid(scattered, [0, 1, 2])).toBeNull();
    const line = Array.from({ length: 30 }, (_, k) => [k, 0, k * k]);
    expect(nativeCellGrid(line, [0, 1, 2])).toBeNull();
  });
  it("merges axis values that differ only by float noise", () => {
    const g = nativeCellGrid([[0.1 + 0.2, 0, 1], [0.3, 1, 2], [0.6, 0, 3], [0.6, 1, 4]], [0, 1, 2]);
    expect(g?.xAxis).toHaveLength(2);
  });
});

describe("nativeCellGrid with jittered stage positions (wire fixture cell_jitter)", () => {
  it.each(JITTER_CASES)("$name", (c) => {
    const g = nativeCellGrid(c.rows, [0, 1, 2]);
    if (c.x === null) return expect(g).toBeNull();
    expect(g).not.toBeNull();
    g!.xAxis.forEach((v, k) => expect(v).toBeCloseTo(c.x![k], 6));
    g!.yAxis.forEach((v, k) => expect(v).toBeCloseTo(c.y![k], 6));
    expect(g!.values).toEqual(c.values);
    const got = nativeCellSpots(g!, c.frame, c.size, { format: c.format, precision: c.precision }, c.font);
    expect(got.map(({ i, j, text }) => ({ i, j, text }))).toEqual(c.spots.map(({ i, j, text }) => ({ i, j, text })));
  });
  it("an exact lattice reads exactly as before (the jitter path is not taken)", () => {
    const pts: number[][] = [];
    for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) pts.push([i * 0.5, j, i + j]);
    expect(nativeCellGrid(pts, [0, 1, 2])?.xAxis).toEqual([0, 0.5, 1, 1.5, 2]);
  });
  it("jitter on one axis only, and the tolerance edge (0.15 of a step reads, 0.45 does not)", () => {
    const make = (amp: number) => {
      const pts: number[][] = [];
      for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) pts.push([i + (((i * 7 + j * 3) % 5) - 2) * 0.5 * amp, j, i]);
      return pts;
    };
    expect(nativeCellGrid(make(0.15), [0, 1, 2])?.xAxis).toHaveLength(5); // +-0.15 of the step
    expect(nativeCellGrid(make(0.45), [0, 1, 2])).toBeNull(); // +-0.45
  });
  it("scattered points and a jittered line scan are still not lattices", () => {
    const scattered = Array.from({ length: 200 }, (_, k) => [Math.sin(k * 12.9) * 7, Math.cos(k * 7.3) * 5, k]);
    expect(nativeCellGrid(scattered, [0, 1, 2])).toBeNull();
    const line = Array.from({ length: 60 }, (_, k) => [k + Math.sin(k) * 0.05, Math.sin(k * 3) * 0.01, k]);
    expect(nativeCellGrid(line, [0, 1, 2])).toBeNull();
  });
  it("a big cloud is not clustered at all", () => {
    const cloud = Array.from({ length: 30000 }, (_, k) => [Math.sin(k) * 7, Math.cos(k * 1.7) * 5, k]);
    expect(nativeCellGrid(cloud, [0, 1, 2])).toBeNull();
  });
});
