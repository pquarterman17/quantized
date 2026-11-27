import { describe, expect, it } from "vitest";

import { recordedRowWindow, stampInputRowRanges } from "./inputRowRange";
import type { DataStruct } from "./types";

const data: DataStruct = { time: [0], values: [[1]], labels: ["o"], units: [""], metadata: {} };

describe("recordedRowWindow", () => {
  it("reads a snapshot's envelope range as a 0-based window", () => {
    expect(recordedRowWindow({ rowRange: { from: 20, to: 43, rows: 48 } })).toEqual({ from: 20, to: 43 });
    expect(recordedRowWindow({})).toBeNull();
    expect(recordedRowWindow({ rowRange: { from: 5, to: 2, rows: 48 } })).toBeNull(); // malformed: fails closed
  });
  it("reads an output worksheet's record, picking the source's entry", () => {
    const out = stampInputRowRanges(data, [{ datasetId: "a", from: 1, to: 3, rows: 9 }, { datasetId: "b", from: 4, to: 6, rows: 9 }]);
    expect(recordedRowWindow(undefined, out.metadata, "b")).toEqual({ from: 4, to: 6 });
    expect(recordedRowWindow(undefined, out.metadata, "zzz")).toBeNull();
    expect(recordedRowWindow(undefined, data.metadata, "a")).toBeNull();
  });
});
