// Origin gap audit 2 #1: a graph's curves reference their sources
// (datasetId, xKey, yKey) and the graph's rows are assembled from the LIVE
// sources -- segment-concatenated, never a sorted X union.

import { describe, expect, it } from "vitest";

import { remapDatasetChannels } from "./channelRemap";
import { assembleLinkedCurves, sanitizeLinkedCurves } from "./linkedCurves";
import type { Dataset } from "./types";

const ds = (id: string, time: number[], cols: number[][], labels: string[], meta = {}): Dataset => ({
  id,
  name: id,
  data: { time, values: time.map((_, r) => cols.map((c) => c[r])), labels, units: labels.map(() => "emu"), metadata: meta },
});

// A hysteresis-style loop: H runs 5 -> -5 -> 5 (non-monotonic).
const loop = ds("loop", [0, 1, 2, 3], [[5, -5, 5, 0], [1, -1, 1, 0]], ["H", "M"], { x_column_name: "t", x_column_unit: "s" });
const scan = ds("scan", [10, 20], [[7, 8]], ["M"], { x_column_name: "T", x_column_unit: "K" });

describe("assembleLinkedCurves", () => {
  it("one block per (source, X), each curve only in its own block, row order kept", () => {
    const out = assembleLinkedCurves(
      [
        { datasetId: "loop", xKey: 0, yKey: 1, label: "loop: M" },
        { datasetId: "scan", xKey: null, yKey: 0, label: "scan" },
      ],
      [loop, scan],
    );
    expect(out.time).toEqual([5, -5, 5, 0, 10, 20]);
    expect(out.values.map((r) => r[0])).toEqual([1, -1, 1, 0, NaN, NaN]);
    expect(out.values.map((r) => r[1])).toEqual([NaN, NaN, NaN, NaN, 7, 8]);
    expect(out.labels).toEqual(["loop: M", "scan"]);
    expect(out.metadata.column_comments).toEqual({ c0: "M", c1: "M" }); // the source quantity
    expect(out.units).toEqual(["emu", "emu"]);
    expect([out.metadata.x_column_long, out.metadata.x_column_unit]).toEqual(["H (emu) / T (K)", ""]);
  });

  it("a source's excluded rows are gaps in its curve", () => {
    const masked = { ...scan, excludedRows: [0] };
    const out = assembleLinkedCurves([{ datasetId: "scan", xKey: null, yKey: 0, label: "scan" }], [masked]);
    expect(out.values.map((r) => r[0])).toEqual([NaN, 8]);
    expect(out.metadata.x_column_long).toBe("T");
  });

  it("a deleted source or a vanished column leaves its curve empty, never rebound", () => {
    const out = assembleLinkedCurves(
      [
        { datasetId: "gone", xKey: null, yKey: 0, label: "gone" },
        { datasetId: "scan", xKey: null, yKey: 3, label: "bad col" },
        { datasetId: "scan", xKey: null, yKey: 0, label: "scan" },
      ],
      [scan],
    );
    expect(out.time).toEqual([10, 20]);
    expect(out.values).toEqual([[NaN, NaN, 7], [NaN, NaN, 8]]);
  });
});

describe("sanitizeLinkedCurves (.dwk load)", () => {
  it("keeps well-formed curves and keeps a malformed one as an empty slot (finding 9)", () => {
    expect(
      sanitizeLinkedCurves([
        { datasetId: "a", xKey: null, yKey: 1, label: "A" },
        { datasetId: "b", xKey: 2, yKey: 0 },
        { datasetId: 3, xKey: null, yKey: 0 },
        { datasetId: "c", xKey: -2, yKey: 0 },
      ]),
    ).toEqual([
      { datasetId: "a", xKey: null, yKey: 1, label: "A" },
      { datasetId: "b", xKey: 2, yKey: 0, label: "" },
      // Malformed entries keep their SLOT (later curves keep their column), bound to nothing, drawn empty.
      { datasetId: "", xKey: null, yKey: -1, label: "" },
      { datasetId: "", xKey: null, yKey: -1, label: "" },
    ]);
    expect(sanitizeLinkedCurves("nope")).toBeUndefined();
  });
});

describe("a graph column removed (remapDatasetChannels)", () => {
  it("drops that curve, keeps the rest in order; an insertion is not a curve", () => {
    const curves = [
      { datasetId: "a", xKey: null, yKey: 0, label: "A" },
      { datasetId: "b", xKey: null, yKey: 0, label: "B" },
    ];
    expect(remapDatasetChannels({ linkedCurves: curves }, 0).linkedCurves).toEqual([curves[1]]);
    expect(remapDatasetChannels({ linkedCurves: curves }, { inserted: 0 }).linkedCurves).toEqual(curves);
  });

  it("a curve whose source column was removed (-1) survives a .dwk round trip, drawn empty", () => {
    const kept = sanitizeLinkedCurves([{ datasetId: "scan", xKey: null, yKey: -1, label: "gone col" }]);
    expect(kept).toEqual([{ datasetId: "scan", xKey: null, yKey: -1, label: "gone col" }]);
    expect(assembleLinkedCurves(kept!, [scan]).values).toEqual([]);
  });
});
