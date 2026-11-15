// Review finding 7: a fit of a Y that belongs to a secondary X column (T1,R1,
// T2,R2) must use ITS X, as the plot does (lib/perSeriesX.ts), not the plot's
// shared X.

import { describe, expect, it } from "vitest";

import { selectedFitData } from "./fitselection";
import type { Dataset } from "./types";

const sheet: Dataset = {
  id: "m",
  name: "m",
  data: { time: [1, 2, 3], values: [[10, 5, 100], [20, 3, 200], [30, 9, 300]], labels: ["R1", "T2", "R2"], units: ["", "", ""], metadata: {} },
  columnDesignations: { 1: "X" },
};

describe("selectedFitData on a multi-X sheet", () => {
  it("fits R2 against T2 and R1 against T1", () => {
    const r2 = selectedFitData(sheet, null, [2], null)!;
    expect(r2.yKey).toBe(2);
    expect(r2.x).toEqual([5, 3, 9]);
    const r1 = selectedFitData(sheet, null, [0], null)!;
    expect(r1.x).toEqual([1, 2, 3]);
  });
  it("a subset range still filters on that X", () => {
    const r2 = selectedFitData(sheet, null, [2], null, { rowIds: null, range: { lo: 4, hi: 10, source: "manual" } })!;
    expect(r2.x).toEqual([5, 9]);
    expect(r2.y).toEqual([100, 300]);
  });
  it("a plain one-X sheet is unchanged", () => {
    const plain: Dataset = { ...sheet, columnDesignations: undefined };
    expect(selectedFitData(plain, null, [2], null)!.x).toEqual([1, 2, 3]);
  });
});

describe("global-fit members and ownXKey", () => {
  it("a member on a secondary-X Y reads its own X; ownXKey falls back to the plot X", async () => {
    const { memberData } = await import("../components/workshops/curvefit/globalFitData");
    const { ownXKey } = await import("./perSeriesX");
    expect(memberData(sheet, { datasetId: "m", xKey: null, yKey: 2 } as never)!.x).toEqual([5, 3, 9]);
    expect(memberData(sheet, { datasetId: "m", xKey: null, yKey: 0 } as never)!.x).toEqual([1, 2, 3]);
    expect(ownXKey(sheet, null, 2)).toBe(1);
    expect(ownXKey(sheet, null, 0)).toBeNull();
    expect(ownXKey({ data: sheet.data }, 1, 0)).toBe(1);
  });
});
