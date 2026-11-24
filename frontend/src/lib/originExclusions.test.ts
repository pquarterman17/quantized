// B-38 (owner decision 2026-11-24): rows an Origin import proved masked in
// every filled column (`metadata.origin_excluded_rows`, opju_row_masks.py)
// become ordinary row exclusions -- on a full book at import, on a lazy book
// at its FIRST install (a preview's rows are not the book's).

import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchBookData } from "./api";
import { installBookData, resetBookTransportForTests } from "./bookData";
import { originExclusionPatch, withOriginExclusions } from "./rowstate";
import type { BookSource, Dataset, DataStruct } from "./types";

vi.mock("./api", async (orig) => ({
  ...(await orig<typeof import("./api")>()),
  fetchBookData: vi.fn(),
}));

const full = (excluded?: unknown): DataStruct => ({
  time: [0, 1, 2, 3],
  values: [[1], [2], [3], [4]],
  labels: ["y"],
  units: [""],
  metadata: excluded === undefined ? {} : { origin_excluded_rows: excluded },
});

describe("withOriginExclusions", () => {
  it("merges the stamped rows, dropping any that are not rows of the data", () => {
    expect(withOriginExclusions(full([2, 0, 9, -1, 1.5]))).toEqual([0, 2]);
    expect(withOriginExclusions(full([2]), [1])).toEqual([1, 2]);
    expect(withOriginExclusions(full(), [3])).toEqual([3]);
    expect(withOriginExclusions(full())).toBeUndefined();
    expect(originExclusionPatch(full([1]))).toEqual({ excludedRows: [1] });
    expect(originExclusionPatch(full("x"))).toEqual({});
  });
});

describe("a lazy Origin book's masked rows", () => {
  const SOURCE: BookSource = { kind: "path", path: "/p.opju", bookId: "b1", rows: 4, cols: 1, previewSampled: false };
  let state: { datasets: Dataset[] };
  const set = (fn: (s: { datasets: Dataset[] }) => { datasets: Dataset[] }) => {
    state = fn(state);
  };
  const pending = (over: Partial<Dataset> = {}): Dataset => ({
    id: "d1",
    name: "p.opju:Book1",
    data: { ...full([3]), time: [0, 1], values: [[1], [2]] }, // a preview: rows 0-1 only
    pending: SOURCE,
    ...over,
  });

  beforeEach(() => {
    resetBookTransportForTests();
    vi.mocked(fetchBookData).mockResolvedValue(full([3]));
  });

  it("join on the first install, beside the user's own exclusions", async () => {
    state = { datasets: [pending({ excludedRows: [1] })] };
    await installBookData(set, "d1", SOURCE);
    expect(state.datasets[0].excludedRows).toEqual([1, 3]);
  });

  it("are not re-added by a later install (the user may have un-excluded them)", async () => {
    state = { datasets: [pending({ installEpoch: 1 })] };
    await installBookData(set, "d1", SOURCE);
    expect(state.datasets[0].excludedRows).toBeUndefined();
  });
});
