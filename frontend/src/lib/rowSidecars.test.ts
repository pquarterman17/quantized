// Unit pins for the row-sidecar primitives. The store-level BUG-006 tests
// (store/cellEdit.test.ts, lib/datasetsplit.test.ts) cover the behaviour a user
// sees; these cover the two invariants that, when they broke, broke silently:
// the index list's LENGTH tracking the grid, and the row span being taken from
// the sidecars rather than from `time`.

import { describe, expect, it } from "vitest";

import { resolveCategoryLabels } from "./barlayout";
import { facetSlices } from "./facet";
import {
  asPreviewSourceRows,
  concatRowSidecars,
  insertRowIndexes,
  PREVIEW_SOURCE_ROWS,
  ROW_INDEXED_SIDECARS,
  sidecarRowCount,
  sliceRowSidecars,
  withoutRowSidecars,
} from "./rowSidecars";
import { pruneExcluded } from "./rowstate";
import type { DataStruct } from "./types";

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

  it("removes the PREVIEW_SOURCE_ROWS map too — a rebuild happens in the caller's row space", () => {
    // `mergeDatasets` inherits dataset 0's non-row-indexed metadata wholesale and
    // then rebuilds the sidecars with `concatRowSidecars`, in ITS row space. A
    // preview->source map describing dataset 0's old preview rows must not
    // survive over those. `concatRowSidecars` emits every column at exactly the
    // summed span, so a reader's length check would not consult it today — this
    // makes the safety a property of the module rather than of that arithmetic.
    const out = withoutRowSidecars({
      text_columns: { A: ["a"] },
      [PREVIEW_SOURCE_ROWS]: [0, 2, 4],
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

// The two claims `asPreviewSourceRows`' own doc makes that the layer tests above
// it (lib/barlayout.test.ts, store/importDatasets.test.ts) exercise only
// indirectly.
describe("asPreviewSourceRows", () => {
  it("accepts a PERMUTATION — order is deliberately not required", () => {
    // The doc says a reader looking up `sidecar[map[r]]` is correct for any
    // permutation, so rejecting an unsorted map would throw away a working label
    // source over a guess about the producer. That promise needs a test — with a
    // genuine permutation. An earlier version of this test also asserted that
    // `[2,2]` was accepted, which pinned the REPEAT hazard below as a feature.
    expect(asPreviewSourceRows([5, 1, 4, 2], 4, 6)).toEqual([5, 1, 4, 2]);
    expect(asPreviewSourceRows([3, 2, 1, 0], 4, 6)).toEqual([3, 2, 1, 0]); // fully reversed
    expect(asPreviewSourceRows([5, 4, 3, 2, 1, 0], 6, 6)).toEqual([5, 4, 3, 2, 1, 0]);
  });

  it("REJECTS a repeated entry — the one malformation that mislabels confidently", () => {
    // Every other malformation degrades. `[0,0,0,0]` does not: every preview row
    // reads source row 0's cell, which is internally CONSISTENT, so
    // `barlayout`'s per-level agreement check sees no contradiction and names
    // every level from row 0 (measured on the 6-row fixture: ["A0","A0","A0"]
    // where the truth is A0/B1/C2). Distinctness is a producer invariant —
    // `io/origin_project/preview.py::_decimate` builds its list from
    // `sorted(keep)` over a `set` — so the check costs an honest producer nothing.
    expect(asPreviewSourceRows([0, 0, 0, 0], 4, 6)).toBeNull();
    expect(asPreviewSourceRows([2, 2], 2, 6)).toBeNull();
    expect(asPreviewSourceRows([1, 2, 4, 2], 4, 6)).toBeNull(); // one repeat is enough
  });

  it("rejects every malformed shape, returning null", () => {
    // The DISCRIMINATING home for the negative/fractional cases: at the
    // barlayout layer a bad index reads as a blank cell and the labels degrade to
    // numbers whether or not anything validated, so only an assertion on the
    // validator's own answer can tell a rejection from a coincidence.
    expect(asPreviewSourceRows([1, 2, 4], 4, 6)).toBeNull(); // short
    expect(asPreviewSourceRows([1, 2, 4, 5, 0], 4, 6)).toBeNull(); // long
    expect(asPreviewSourceRows([-1, 2, 4, 5], 4, 6)).toBeNull(); // negative
    expect(asPreviewSourceRows([1.5, 2, 4, 5], 4, 6)).toBeNull(); // fractional
    expect(asPreviewSourceRows([1, 2, 4, 6], 4, 6)).toBeNull(); // past the source
    expect(asPreviewSourceRows([1, 2, 4, Number.NaN], 4, 6)).toBeNull();
    expect(asPreviewSourceRows(["1", "2", "4", "5"], 4, 6)).toBeNull();
    expect(asPreviewSourceRows("1,2,4,5", 4, 6)).toBeNull();
    expect(asPreviewSourceRows({ 0: 1, length: 4 }, 4, 6)).toBeNull();
    expect(asPreviewSourceRows(null, 4, 6)).toBeNull();
    expect(asPreviewSourceRows(undefined, 4, 6)).toBeNull();
  });

  it("treats an omitted sourceRowCount as unbounded, not as zero", () => {
    // A consumer that knows the preview's row count but not the source's (there
    // is no such caller today) must still get its map, not a silent refusal from
    // an accidental `?? 0`.
    expect(asPreviewSourceRows([9999], 1)).toEqual([9999]);
  });

  it("is NOT one of the row-indexed sidecars — that exemption is load-bearing", () => {
    // `sliceOneSidecar` returns a bare array untouched, so registering this key
    // would buy no slicing and imply one. See its doc for the full argument; this
    // pins the decision so a future "add every new metadata key to the list"
    // sweep has to read it first.
    expect([...ROW_INDEXED_SIDECARS] as string[]).not.toContain(PREVIEW_SOURCE_ROWS as string);
  });
});

// Review finding 2: the batch argued that no row operation could mislabel
// through `PREVIEW_SOURCE_ROWS` — "one that leaves a stale map behind fails the
// length/bounds check and degrades to numbers. Neither can mislabel." False for
// `sliceRowSidecars`, which both REBUILT the sidecar to match its rows (restoring
// length agreement, so the map went unread) and mislabelled, because it sliced a
// SOURCE-space sidecar with PREVIEW-row indices. It composes now; this block is
// the counter-example turned into a pin.
describe("sliceRowSidecars COMPOSES the preview->source map", () => {
  const SIDECAR = { Group: ["A0", "A0", "B1", "B1", "C2", "C2"] };
  // A preview that kept source rows 0, 2, 3 and 5 of a 6-row book.
  const PREVIEW = { text_columns: SIDECAR, [PREVIEW_SOURCE_ROWS]: [0, 2, 3, 5] };

  it("leaves the SOURCE-space sidecar unsliced", () => {
    // Not an omission: those cells are indexed by source row, and the slice's
    // indexes are preview rows. Cutting the column with them would not produce a
    // smaller version of it, it would produce different cells.
    expect(sliceRowSidecars(PREVIEW, [0, 2])["text_columns"]).toEqual(SIDECAR);
  });

  it("composes the map through the row indexes", () => {
    // Output row 0 is preview row 0, i.e. source row 0; output row 1 is preview
    // row 2, i.e. source row 3.
    expect(sliceRowSidecars(PREVIEW, [0, 2])[PREVIEW_SOURCE_ROWS]).toEqual([0, 3]);
    expect(sliceRowSidecars(PREVIEW, [1, 2, 3])[PREVIEW_SOURCE_ROWS]).toEqual([2, 3, 5]);
  });

  it("still SLICES the sidecars when there is no map — the ordinary dataset is untouched", () => {
    const out = sliceRowSidecars({ text_columns: SIDECAR }, [0, 2]);
    expect((out["text_columns"] as Record<string, unknown[]>).Group).toEqual(["A0", "B1"]);
    expect(PREVIEW_SOURCE_ROWS in out).toBe(false);
  });

  it("chains: a slice of a slice composes onto the original source rows", () => {
    const once = sliceRowSidecars(PREVIEW, [1, 2, 3]); // preview rows -> [2, 3, 5]
    const twice = sliceRowSidecars(once, [0, 2]); // -> [2, 5]
    expect(twice[PREVIEW_SOURCE_ROWS]).toEqual([2, 5]);
    expect(twice["text_columns"]).toEqual(SIDECAR);
  });

  it("DROPS the map when an index falls outside it (an insert's blank slots)", () => {
    // An inserted row came from no source row, so there is no honest entry to
    // write for it. Dropping leaves the source-space sidecar with no map, which
    // is the shape every reader's length check degrades to numbers.
    const out = sliceRowSidecars(PREVIEW, insertRowIndexes(4, 1, 1));
    expect(PREVIEW_SOURCE_ROWS in out).toBe(false);
    expect(out["text_columns"]).toEqual(SIDECAR);
  });

  it("DROPS the map when composing it would REPEAT a source row", () => {
    // A stack-shaped [0,0,1,1] index list is truthful — two output rows really do
    // come from one preview row — but the composed map would not itself pass
    // `asPreviewSourceRows`, and nothing here may store a map a reader refuses.
    expect(PREVIEW_SOURCE_ROWS in sliceRowSidecars(PREVIEW, [0, 0, 1, 1])).toBe(false);
  });

  it("DROPS a malformed map rather than composing through it", () => {
    for (const bad of [[0, 2, 3.5, 5], [0, 2, -3, 5], [0, 2, 2, 5], "0,2,3,5", { 0: 0 }, null]) {
      const out = sliceRowSidecars({ text_columns: SIDECAR, [PREVIEW_SOURCE_ROWS]: bad }, [0, 2]);
      expect(PREVIEW_SOURCE_ROWS in out, JSON.stringify(bad)).toBe(false);
    }
  });

  it("does not mutate its input", () => {
    sliceRowSidecars(PREVIEW, [0, 2]);
    expect(PREVIEW[PREVIEW_SOURCE_ROWS]).toEqual([0, 2, 3, 5]);
    expect(SIDECAR.Group).toHaveLength(6);
  });
});

// The same three cases end to end, as the LABELS a user would have read off the
// plot. Each was measured wrong before the composition above; each asserts the
// truth here, so a revert shows up as a wrong NAME rather than as a changed
// metadata shape.
describe("a sliced preview's category labels (review finding 2, all three measured cases)", () => {
  const TEXT = ["A0", "A0", "B1", "B1", "C2", "C2"];

  it("facetSlices: every PANEL resolves its OWN level, not a neighbour's", () => {
    // 6-row book, levels [0,0,1,1,2,2]; the preview kept source rows [0,2,3,5],
    // so its own levels are [0,1,1,2]. The flat view was already right
    // (["A0","B1","C2"]); faceting by the same column was not — each panel's own
    // DataStruct resolved ["A0"], ["1"] and ["B1"], i.e. the level-2 panel
    // labelled its own box "B1".
    const preview: DataStruct = {
      time: [0, 2, 3, 5],
      values: [[0], [1], [1], [2]],
      labels: ["Group"],
      units: [""],
      metadata: { text_columns: { Group: TEXT }, [PREVIEW_SOURCE_ROWS]: [0, 2, 3, 5] },
    };
    expect(resolveCategoryLabels(preview, 0, [0, 1, 2])).toEqual(["A0", "B1", "C2"]);
    const panels = facetSlices(preview, 0);
    expect(panels.map((p) => p.label)).toEqual(["A0", "B1", "C2"]);
    // The panel-by-panel claim, which is where the defect lived: panel i holds
    // only level i's rows, so it must resolve level i on its own.
    expect(panels.map((p, i) => resolveCategoryLabels(p.data, 0, [i]))).toEqual([
      ["A0"],
      ["B1"],
      ["C2"],
    ]);
  });

  it("pruneExcluded: excluding a preview row does not slide the remaining labels", () => {
    // A 6-row book with one level per row; the preview kept source rows [0,2,4],
    // i.e. levels [0,2,4]. Exclude preview row 2 (level 4) and the truth for the
    // two survivors is ["A0","B1"]; the slice produced ["A0","A0"].
    const preview: DataStruct = {
      time: [0, 2, 4],
      values: [[0], [2], [4]],
      labels: ["Group"],
      units: [""],
      metadata: { text_columns: { Group: TEXT }, [PREVIEW_SOURCE_ROWS]: [0, 2, 4] },
    };
    expect(resolveCategoryLabels(pruneExcluded(preview, [2]), 0, [0, 2])).toEqual(["A0", "B1"]);
  });

  it("pruneExcluded, distinct-text variant: the wrong answer was a REAL other row's cell", () => {
    // Same shape with six distinct cells, so the defect cannot hide behind a
    // repeated one: excluding preview row 1 leaves source rows 0 and 4, truth
    // ["T0","T4"], and the slice read ["T0","T2"] — T2 being a genuine cell of a
    // row that is not in the view at all.
    const preview: DataStruct = {
      time: [0, 2, 4],
      values: [[0], [2], [4]],
      labels: ["Group"],
      units: [""],
      metadata: {
        text_columns: { Group: ["T0", "T1", "T2", "T3", "T4", "T5"] },
        [PREVIEW_SOURCE_ROWS]: [0, 2, 4],
      },
    };
    expect(resolveCategoryLabels(pruneExcluded(preview, [1]), 0, [0, 4])).toEqual(["T0", "T4"]);
  });
});
