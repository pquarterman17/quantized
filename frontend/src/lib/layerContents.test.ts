// Gap audit 3 N1: a Layer Contents draft becomes column shifts that put every
// kept curve where the draft says, and names what can't be applied.

import { describe, expect, it } from "vitest";

import { remapChannel } from "./channelRemap";
import { layerRowsChanged, layerRowsOf, layerRowsProblems, layerShifts, type LayerRow } from "./layerContents";
import type { Dataset, LinkedCurve } from "./types";

const c = (datasetId: string, yKey: number): LinkedCurve => ({ datasetId, xKey: null, yKey, label: `${datasetId}${yKey}` });

/** Where each old column lands after the shifts (null = removed). */
function landing(n: number, rows: LayerRow[]): (number | null)[] {
  return Array.from({ length: n }, (_, i) =>
    layerShifts(n, rows).reduce<number | null>((at, s) => (at === null ? null : remapChannel(at, s)), i),
  );
}

describe("layerShifts", () => {
  it("removes, reorders and inserts so each kept curve lands at its draft position", () => {
    const old = [c("a", 0), c("b", 0), c("c", 0), c("d", 0)];
    // Draft: d, new, b, a  (c removed)
    const rows: LayerRow[] = [
      { curve: old[3], from: 3 },
      { curve: c("e", 0), from: null },
      { curve: old[1], from: 1 },
      { curve: old[0], from: 0 },
    ];
    expect(landing(4, rows)).toEqual([3, 2, null, 0]);
  });

  it("an unchanged draft needs no shift and reports no change", () => {
    const old = [c("a", 0), c("b", 0)];
    expect(layerShifts(2, layerRowsOf(old))).toEqual([]);
    expect(layerRowsChanged(old, layerRowsOf(old))).toBe(false);
    expect(layerRowsChanged(old, [{ curve: { ...old[0], yKey: 1 }, from: 0 }, { curve: old[1], from: 1 }])).toBe(true);
  });
});

describe("layerRowsProblems (fail closed)", () => {
  const ds = (id: string): Dataset => ({ id, name: id.toUpperCase(), data: { time: [0], values: [[1, 2]], labels: ["Y", "Z"], units: ["", ""], metadata: {} } });
  const datasets = [ds("a"), ds("b")];
  const none = () => false;

  it("a re-bound curve with no Y chosen, or a column the source lacks, is named", () => {
    const old = [c("a", 0)];
    expect(layerRowsProblems(old, [{ curve: { datasetId: "b", xKey: null, yKey: -1, label: "" }, from: 0 }], datasets, none)).toEqual([
      "Curve 1: choose a Y column of “B”",
    ]);
    expect(layerRowsProblems(old, [{ curve: { datasetId: "b", xKey: 5, yKey: 1, label: "" }, from: 0 }], datasets, none)[0]).toMatch(/X column/);
    expect(layerRowsProblems(old, [{ curve: c("gone", 0), from: null }], datasets, none)[0]).toMatch(/choose a source dataset/);
  });

  it("a kept curve whose source is missing stays as it is (no problem); a cycle is refused", () => {
    const old = [c("gone", 0)];
    expect(layerRowsProblems(old, layerRowsOf(old), datasets, none)).toEqual([]);
    expect(layerRowsProblems([], [{ curve: c("a", 0), from: null }], datasets, (id) => id === "a")[0]).toMatch(/depend on each other/);
  });
});
