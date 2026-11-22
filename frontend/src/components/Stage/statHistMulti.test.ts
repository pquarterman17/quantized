import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct } from "../../lib/types";

const multi = vi.fn();
const single = vi.fn();
vi.mock("../../lib/api", () => ({ statsHistogram: (...a: unknown[]) => single(...a), statsHistogramMulti: (...a: unknown[]) => multi(...a) }));

import { computeHistogramDraw, histogramColumns, multiHistogramSpec } from "./statHistMulti";

const data: DataStruct = {
  time: [0, 1, 2],
  values: [[1, 2, 2], [3, 4, 5], [NaN, 5, 5]],
  labels: ["A", "B", "C"],
  units: ["", "", ""],
  metadata: {},
};

beforeEach(() => {
  multi.mockReset();
  single.mockReset();
});

describe("multi-column histogram", () => {
  it("histogramColumns keeps the value column first and drops repeats and missing columns", () => {
    expect(histogramColumns(1, [1, 0, 7, 0, -1], 3)).toEqual([1, 0]);
  });

  it("several columns call the shared-edges route with each column's finite values", async () => {
    multi.mockResolvedValue({ edges: [1, 3, 5], series: [{ counts: [1, 1] }, { counts: [1, 2] }] });
    const d = await computeHistogramDraw(data, [0, 1], ["A", "B"], "fd", "norm", "A");
    expect(multi).toHaveBeenCalledWith([[1, 3], [2, 4, 5]], "fd");
    expect(single).not.toHaveBeenCalled(); // and no fit is drawn for several columns
    expect(d).toMatchObject({ mode: "histogram", edges: [1, 3, 5], counts: [1, 1], density: false });
    expect(d.mode === "histogram" && d.series).toEqual([{ label: "A", counts: [1, 1] }, { label: "B", counts: [1, 2] }]);
  });

  it("one column is the unchanged single-column histogram, with its fit", async () => {
    single.mockResolvedValue({ edges: [1, 2], counts: [2], density: true });
    await computeHistogramDraw(data, [1], ["B"], "fd", "norm", "B");
    expect(single).toHaveBeenCalledWith([2, 4, 5], "fd", "norm");
    await expect(computeHistogramDraw({ ...data, values: [[NaN]], time: [0] }, [0], ["A"], "fd", null, "A")).rejects.toThrow("finite");
  });

  it("the export request carries one list per column and the column names", () => {
    const spec = multiHistogramSpec(data, [0, 2], ["A", "C"], "fd", "svg", "A");
    expect(spec).toMatchObject({ kind: "histogram", data: [[1, 3], [2, 5, 5]], labels: ["A", "C"], bins: "fd", fmt: "svg" });
    expect(multiHistogramSpec({ ...data, values: [[NaN]], time: [0] }, [0], ["A"], "fd", "svg", "A")).toBeNull();
  });
});
