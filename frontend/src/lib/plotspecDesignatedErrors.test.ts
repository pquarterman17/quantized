// Reader-lane live check (an Origin book with Y-error columns): Graph
// Builder, seeded from a worksheet selection or "Remake in Graph Builder",
// listed the yErr columns as plain Y series and left the error wells empty.
// The seed now binds them to their Y from Dataset.errorRoles (Origin's
// nearest-preceding-Y rule, seeded from the designations at import).

import { beforeEach, describe, expect, it } from "vitest";

import { originBookErrorRoles } from "./originBookRoles";
import { seedDesignatedErrorZones } from "./plotspecDesignatedErrors";
import type { PlotSpec } from "./plotspec";
import type { DataStruct, Dataset } from "./types";
import { openWorksheetGraphBuilder } from "../store/worksheetAnalysisHandoff";
import { useApp } from "../store/useApp";

// A=X (time), B=Y, C=yErr (of B), D=Y, E=yErr (of D)
const data: DataStruct = {
  time: [0, 1, 2],
  values: [
    [1, 0.1, 5, 0.5],
    [2, 0.1, 6, 0.5],
    [3, 0.1, 7, 0.5],
  ],
  labels: ["Dose", "Dose sd", "Rate", "Rate sd"],
  units: ["", "", "", ""],
  metadata: {
    origin_book: "Book1",
    x_column_name: "A",
    origin_column_names: ["B", "C", "D", "E"],
    column_designations: { A: "X", B: "Y", C: "Y-error", D: "Y", E: "Y-error" },
  },
};
const book: Dataset = { id: "do", name: "DO:Book1", data, ...(originBookErrorRoles(data) ?? {}) };

const ref = (channel: number) => ({ datasetId: "do", channel });
const spec = (y: number[]): PlotSpec => ({ version: 1, zones: { x: null, y: y.map(ref), group: null, facet: null, yErr: [], xErr: null }, mark: "scatter" });

describe("Graph Builder seed: Y-error designated columns are error bars, not series", () => {
  it("binds each yErr to its nearest-preceding Y and drops it from the Y series", () => {
    const seeded = seedDesignatedErrorZones(spec([0, 1, 2, 3]), book);
    expect(seeded.zones.y).toEqual([ref(0), ref(2)]);
    expect(seeded.zones.yErr).toEqual([ref(1), ref(3)]);
  });

  it("leaves a dataset with no bound errors unchanged", () => {
    const s = spec([0, 2]);
    expect(seedDesignatedErrorZones(s, { id: "do", errorRoles: [] })).toBe(s);
  });

  beforeEach(() => useApp.setState({ datasets: [book], graphBuilderSeed: null }));

  it("the worksheet's Open in Graph Builder carries them (all columns selected)", () => {
    expect(openWorksheetGraphBuilder(data, "do", [-1, 0, 1, 2, 3])).toBe(true);
    const seed = useApp.getState().graphBuilderSeed!;
    expect(seed.zones.y.map((r) => r.channel)).toEqual([0, 2]);
    expect(seed.zones.yErr.map((r) => r.channel)).toEqual([1, 3]);
  });
});
