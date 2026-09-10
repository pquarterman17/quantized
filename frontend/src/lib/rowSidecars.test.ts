// Unit pins for the row-sidecar primitives. The store-level BUG-006 tests
// (store/cellEdit.test.ts, lib/datasetsplit.test.ts) cover the behaviour a user
// sees; these cover the two invariants that, when they broke, broke silently:
// the index list's LENGTH tracking the grid, and the row span being taken from
// the sidecars rather than from `time`.

import { describe, expect, it } from "vitest";

import {
  concatRowSidecars,
  insertRowIndexes,
  sidecarRowCount,
  sliceRowSidecars,
  withoutRowSidecars,
} from "./rowSidecars";

describe("insertRowIndexes", () => {
  it("splices the blank slots in at `at`", () => {
    expect(insertRowIndexes(3, 1, 2)).toEqual([0, -1, -1, 1, 2]);
  });

  it("clamps an out-of-range `at` to an append / a prepend", () => {
    expect(insertRowIndexes(3, 99, 1)).toEqual([0, 1, 2, -1]);
    expect(insertRowIndexes(3, -5, 1)).toEqual([-1, 0, 1, 2]);
  });

  it("truncates a non-integer `at` the way the numeric insert does", () => {
    // `values.slice(0, 1.5)` keeps ONE row, so the sidecar split must too.
    // Un-truncated this produced [0, -1, 1.5]: an index that hits no cell, and
    // a list one entry short of the grid it is supposed to describe.
    expect(insertRowIndexes(3, 1.5, 1)).toEqual([0, -1, 1, 2]);
  });

  it("always returns rowCount + count entries", () => {
    for (const at of [-1, 0, 1.5, 2, 99]) {
      expect(insertRowIndexes(4, at, 3)).toHaveLength(7);
    }
    expect(insertRowIndexes(4, 0, -2)).toHaveLength(4); // a negative count inserts nothing
    expect(insertRowIndexes(4, Number.NaN, Number.NaN)).toEqual([0, 1, 2, 3]); // and NaN is a no-op
  });
});

describe("sidecarRowCount", () => {
  it("is the grid's row count when no sidecar reaches past it", () => {
    expect(sidecarRowCount({ text_columns: { A: ["a", "b"] } }, 5)).toBe(5);
  });

  it("is the LONGEST sidecar column when one reaches past the grid", () => {
    expect(
      sidecarRowCount({ text_columns: { A: ["a", "b"], B: ["a", "b", "c", "d"] } }, 2),
    ).toBe(4);
  });

  it("covers every allowlisted spelling, and only those", () => {
    expect(sidecarRowCount({ origin_text_columns: { A: [1, 2, 3] } }, 0)).toBe(3);
    expect(sidecarRowCount({ origin_report_sheets: { R: [1, 2, 3] } }, 0)).toBe(3);
    expect(sidecarRowCount({ per_channel_notes: { A: [1, 2, 3] } }, 0)).toBe(0);
  });

  it("ignores a sidecar of the wrong shape rather than throwing", () => {
    expect(sidecarRowCount({ text_columns: ["a", "b", "c"] }, 1)).toBe(1);
    expect(sidecarRowCount({ text_columns: null }, 1)).toBe(1);
    expect(sidecarRowCount({ text_columns: { A: "abc" } }, 1)).toBe(1);
  });
});

describe("sliceRowSidecars", () => {
  it("drops TRAILING misses instead of padding the column out", () => {
    // A column shorter than the grid stays short: it already reads as blank for
    // the rows it doesn't cover, and padding grows the saved file on every edit.
    const out = sliceRowSidecars({ text_columns: { A: ["a0"] } }, [0, 1, 2]);
    expect((out["text_columns"] as Record<string, string[]>).A).toEqual(["a0"]);
  });

  it("still blanks a miss INSIDE the kept range", () => {
    const out = sliceRowSidecars({ text_columns: { A: ["a0", "a1"] } }, [0, -1, 1]);
    expect((out["text_columns"] as Record<string, string[]>).A).toEqual(["a0", "", "a1"]);
  });

  it("keeps a falsy cell as itself rather than coercing it to a blank", () => {
    const out = sliceRowSidecars({ text_columns: { A: ["", 0, "a2"] } }, [0, 1, 2]);
    expect((out["text_columns"] as Record<string, unknown>).A).toEqual(["", 0, "a2"]);
  });

  it("returns a corrupted sidecar untouched rather than reshaping it", () => {
    const bare = ["a", "b"];
    expect(sliceRowSidecars({ text_columns: bare }, [1])["text_columns"]).toBe(bare);
  });
});

// The Group P review found every branch of `concatRowSidecars` untested — it was
// reachable only through `mergeDatasets`, so the all-blank prune (the branch that
// kept BUG-006 site 8 open) could be deleted with the whole suite still green.
describe("concatRowSidecars", () => {
  const part = (cells: Record<string, unknown[]>, rowCount: number) => ({
    metadata: { text_columns: cells },
    rowCount,
  });

  it("concatenates each part at exactly its own rowCount", () => {
    const out = concatRowSidecars([part({ A: ["a0", "a1"] }, 2), part({ A: ["b0"] }, 1)]);
    expect((out["text_columns"] as Record<string, unknown[]>).A).toEqual(["a0", "a1", "b0"]);
  });

  it("PADS a part whose column is shorter than its rowCount, keeping later parts aligned", () => {
    // The alignment invariant: part 1's cell must land at index 3, not index 1.
    const out = concatRowSidecars([part({ A: ["a0"] }, 3), part({ A: ["b0"] }, 1)]);
    expect((out["text_columns"] as Record<string, unknown[]>).A).toEqual(["a0", "", "", "b0"]);
  });

  it("truncates a part's cells beyond its rowCount rather than shifting the next part", () => {
    // The caller's job is to pass a rowCount that covers its cells (mergeDatasets
    // uses `sidecarRowCount`); if it doesn't, alignment wins over completeness.
    const out = concatRowSidecars([part({ A: ["a0", "a1", "a2"] }, 1), part({ A: ["b0"] }, 1)]);
    expect((out["text_columns"] as Record<string, unknown[]>).A).toEqual(["a0", "b0"]);
  });

  it("drops a column no part contributes a cell for", () => {
    // This is the branch whose deletion kept site 8 open, and it is only SAFE
    // because `mergeDatasets` strips dataset 0's keys before the rebuild — an
    // omitted key must mean absent, never "inherited".
    const out = concatRowSidecars([part({ A: ["", ""] }, 2), part({ A: [""] }, 1)]);
    expect(out["text_columns"]).toBeUndefined();
  });

  it("treats a zero or negative rowCount as contributing nothing", () => {
    const out = concatRowSidecars([part({ A: ["a0"] }, 0), part({ A: ["b0"] }, -5), part({ A: ["c0"] }, 1)]);
    expect((out["text_columns"] as Record<string, unknown[]>).A).toEqual(["c0"]);
  });

  it("survives a corrupted sidecar shape on any part", () => {
    const parts = [
      { metadata: { text_columns: ["bare", "array"] }, rowCount: 2 },
      { metadata: { text_columns: null }, rowCount: 1 },
      { metadata: {}, rowCount: 1 },
      part({ A: ["c0"] }, 1),
    ];
    const out = concatRowSidecars(parts);
    // The three unusable parts contribute blanks for their rows, not a throw and
    // not a shift: "c0" must land at index 4.
    expect((out["text_columns"] as Record<string, unknown[]>).A).toEqual(["", "", "", "", "c0"]);
  });

  it("covers all three keys, and emits none when no part carries any", () => {
    expect(concatRowSidecars([{ metadata: { source: "a.dat" }, rowCount: 3 }])).toEqual({});
    const out = concatRowSidecars([
      { metadata: { origin_report_sheets: { R: ["r0"] } }, rowCount: 1 },
      { metadata: { origin_text_columns: { S: ["s0"] } }, rowCount: 1 },
    ]);
    expect((out["origin_report_sheets"] as Record<string, unknown[]>).R).toEqual(["r0", ""]);
    expect((out["origin_text_columns"] as Record<string, unknown[]>).S).toEqual(["", "s0"]);
  });
});

describe("withoutRowSidecars", () => {
  it("removes all three keys and keeps everything else", () => {
    const out = withoutRowSidecars({
      text_columns: { A: ["a"] },
      origin_text_columns: { B: ["b"] },
      origin_report_sheets: { R: ["r"] },
      source: "run.dat",
    });
    expect(out).toEqual({ source: "run.dat" });
  });

  it("does not mutate its input", () => {
    const meta = { text_columns: { A: ["a"] } };
    withoutRowSidecars(meta);
    expect(meta.text_columns).toBeDefined();
  });
});
