import { describe, expect, it } from "vitest";

import {
  buildBarMatrix,
  categoryLevels,
  groupedBarSlots,
  resolveCategoryLabels,
  seriesStat,
  stackedSegments,
  stackedTotal,
} from "./barlayout";
import type { DataStruct } from "./types";

describe("categoryLevels", () => {
  it("returns distinct finite values ascending", () => {
    const ds: DataStruct = {
      time: [0, 1, 2, 3, 4],
      values: [[2], [1], [2], [1], [3]],
      labels: ["grp"],
      units: [""],
      metadata: {},
    };
    expect(categoryLevels(ds, 0)).toEqual([1, 2, 3]);
  });

  it("skips non-finite values and supports channel<0 (time column)", () => {
    const ds: DataStruct = {
      time: [1, 1, NaN, 2],
      values: [[0], [0], [0], [0]],
      labels: ["x"],
      units: [""],
      metadata: {},
    };
    expect(categoryLevels(ds, -1)).toEqual([1, 2]);
  });
});

describe("resolveCategoryLabels (RESOLVED decision: text column then numeric fallback)", () => {
  const base: DataStruct = {
    time: [0, 1, 2, 3],
    values: [[1], [2], [1], [2]],
    labels: ["group"],
    units: [""],
    metadata: {},
  };

  it("falls back to formatted numeric levels with no text columns", () => {
    expect(resolveCategoryLabels(base, 0, [1, 2])).toEqual(["1", "2"]);
  });

  it("uses an Origin text column that consistently labels every level", () => {
    const ds: DataStruct = {
      ...base,
      metadata: { origin_text_columns: { B: ["Room A", "Room B", "Room A", "Room B"] } },
    };
    expect(resolveCategoryLabels(ds, 0, [1, 2])).toEqual(["Room A", "Room B"]);
  });

  // P1.4 review P2-5: RED before this fix -- textLabelsFor read ONLY
  // `metadata.origin_text_columns`, so a GENERIC (non-Origin) import's
  // `text_columns` sidecar (io/delimited.py's `text_columns`,
  // io/import_preview.py's `label`-role capture) never labeled a numeric
  // group column, even though columnmeta.ts's `originTextColumns` already
  // reads `text_columns ?? origin_text_columns` for exactly this reason.
  it("uses a GENERIC text_columns sidecar (not just origin_text_columns) that consistently labels every level", () => {
    const ds: DataStruct = {
      ...base,
      metadata: { text_columns: { Sample: ["NbAu-1", "NbAu-2", "NbAu-1", "NbAu-2"] } },
    };
    expect(resolveCategoryLabels(ds, 0, [1, 2])).toEqual(["NbAu-1", "NbAu-2"]);
  });

  it("prefers text_columns over origin_text_columns when both are present (matches columnmeta.ts's ?? order)", () => {
    const ds: DataStruct = {
      ...base,
      metadata: {
        text_columns: { Sample: ["NbAu-1", "NbAu-2", "NbAu-1", "NbAu-2"] },
        origin_text_columns: { B: ["Stale A", "Stale B", "Stale A", "Stale B"] },
      },
    };
    expect(resolveCategoryLabels(ds, 0, [1, 2])).toEqual(["NbAu-1", "NbAu-2"]);
  });

  it("ignores a text column that disagrees with itself on some level", () => {
    const ds: DataStruct = {
      ...base,
      // level 1 maps to "Room A" on row 0 but "Nope" on row 2 -> disqualified.
      metadata: { origin_text_columns: { B: ["Room A", "Room B", "Nope", "Room B"] } },
    };
    expect(resolveCategoryLabels(ds, 0, [1, 2])).toEqual(["1", "2"]);
  });

  it("ignores a text column that doesn't cover every level", () => {
    const ds: DataStruct = {
      ...base,
      metadata: { origin_text_columns: { B: ["Room A", "", "Room A", ""] } }, // level 2 never labeled
    };
    expect(resolveCategoryLabels(ds, 0, [1, 2])).toEqual(["1", "2"]);
  });

  it("picks the first qualifying column in deterministic (sorted) key order", () => {
    const ds: DataStruct = {
      ...base,
      metadata: {
        origin_text_columns: {
          C: ["x", "y", "x", "y"], // doesn't qualify (not level-consistent labels we'd prefer)
          B: ["Room A", "Room B", "Room A", "Room B"],
        },
      },
    };
    // Both "B" and "C" qualify structurally; B sorts first (length-then-lex).
    expect(resolveCategoryLabels(ds, 0, [1, 2])).toEqual(["Room A", "Room B"]);
  });

  it("formats whole numbers without a trailing .0", () => {
    expect(resolveCategoryLabels(base, 0, [1, 2])).toEqual(["1", "2"]);
    const frac: DataStruct = { ...base, values: [[1.5], [2.25], [1.5], [2.25]] };
    expect(resolveCategoryLabels(frac, 0, [1.5, 2.25])).toEqual(["1.5", "2.25"]);
  });

  // P1.4 categorical codes are 0-indexed (`levels[code]`), unlike `base`'s
  // 1/2-valued numeric group column above — a dedicated 0/1-coded fixture.
  const catBase: DataStruct = {
    time: [0, 1, 2, 3],
    values: [[0], [1], [0], [1]],
    labels: ["group"],
    units: [""],
    metadata: {},
  };

  // P1.4: cat_levels is the FIRST source, taking precedence even over an
  // origin_text_columns entry that would otherwise qualify — fixes the
  // pre-P1.4 inconsistency where this module read ONLY origin_text_columns.
  it("a P1.4 categorical channel's own level table wins over origin_text_columns", () => {
    const ds: DataStruct = {
      ...catBase,
      metadata: { origin_text_columns: { B: ["Stale A", "Stale B", "Stale A", "Stale B"] } },
      cat_levels: { 0: ["Room A", "Room B"] },
    };
    expect(resolveCategoryLabels(ds, 0, [0, 1])).toEqual(["Room A", "Room B"]);
  });

  it("a P1.4 categorical channel still falls back to formatted numeric levels for an out-of-table code", () => {
    const ds: DataStruct = { ...catBase, cat_levels: { 0: ["Room A", "Room B"] } };
    expect(resolveCategoryLabels(ds, 0, [0, 1])).toEqual(["Room A", "Room B"]);
    // a level code with no entry in the table falls back to the numeric format
    expect(resolveCategoryLabels(ds, 0, [0, 1, 2])).toEqual(["Room A", "Room B", "2"]);
  });
});

describe("seriesStat", () => {
  it("computes mean and NaN sem for n<2", () => {
    expect(seriesStat([])).toEqual({ mean: NaN, sem: NaN, n: 0 });
    const one = seriesStat([5]);
    expect(one.mean).toBe(5);
    expect(one.n).toBe(1);
    expect(Number.isNaN(one.sem)).toBe(true);
  });

  it("computes sample SEM (Bessel-corrected) for n>=2", () => {
    // values 2,4,6,8: mean=5, sample variance=(9+1+1+9)/3=20/3, sem=sqrt(20/3/4)
    const s = seriesStat([2, 4, 6, 8]);
    expect(s.n).toBe(4);
    expect(s.mean).toBeCloseTo(5, 10);
    expect(s.sem).toBeCloseTo(Math.sqrt(20 / 3 / 4), 10);
  });

  it("ignores non-finite values", () => {
    expect(seriesStat([1, NaN, 3, Infinity])).toEqual({ mean: 2, sem: expect.any(Number), n: 2 });
  });
});

describe("buildBarMatrix", () => {
  it("builds one group per category level, one BarSeriesStat per value channel", () => {
    // group col 0: levels 1,1,2,2 ; value channels 1 (A) and 2 (B)
    const ds: DataStruct = {
      time: [0, 1, 2, 3],
      values: [
        [1, 10, 100],
        [1, 20, 200],
        [2, 30, 300],
        [2, 40, 400],
      ],
      labels: ["grp", "A", "B"],
      units: ["", "", ""],
      metadata: {},
    };
    const m = buildBarMatrix(ds, 0, [1, 2], ["A", "B"]);
    expect(m.seriesLabels).toEqual(["A", "B"]);
    expect(m.groups).toHaveLength(2);
    expect(m.groups[0].label).toBe("1");
    expect(m.groups[0].series[0].mean).toBeCloseTo(15, 10); // (10+20)/2
    expect(m.groups[0].series[1].mean).toBeCloseTo(150, 10); // (100+200)/2
    expect(m.groups[1].label).toBe("2");
    expect(m.groups[1].series[0].mean).toBeCloseTo(35, 10); // (30+40)/2
  });

  it("handles a single value channel (ordinary single-series bar chart)", () => {
    const ds: DataStruct = {
      time: [0, 1, 2],
      values: [[1, 10], [2, 20], [1, 30]],
      labels: ["grp", "val"],
      units: ["", ""],
      metadata: {},
    };
    const m = buildBarMatrix(ds, 0, [1], ["val"]);
    expect(m.groups).toHaveLength(2);
    expect(m.groups[0].series).toHaveLength(1);
    expect(m.groups[0].series[0].mean).toBeCloseTo(20, 10); // (10+30)/2 for level 1
  });

  it("returns an empty-n stat (NaN mean) for a category level with no finite values in a channel", () => {
    const ds: DataStruct = {
      time: [0, 1],
      values: [[1, NaN], [2, 5]],
      labels: ["grp", "val"],
      units: ["", ""],
      metadata: {},
    };
    const m = buildBarMatrix(ds, 0, [1], ["val"]);
    expect(m.groups[0].series[0].n).toBe(0);
    expect(Number.isNaN(m.groups[0].series[0].mean)).toBe(true);
  });
});

describe("groupedBarSlots", () => {
  it("returns [] for n<=0", () => {
    expect(groupedBarSlots(0)).toEqual([]);
    expect(groupedBarSlots(-1)).toEqual([]);
  });

  it("centers a single series at offset 0", () => {
    const slots = groupedBarSlots(1);
    expect(slots).toHaveLength(1);
    expect(slots[0].offset).toBeCloseTo(0, 10);
    expect(slots[0].halfWidth).toBeCloseTo(0.425, 10); // (1*(1-0.15))/2
  });

  it("splits two series symmetrically around zero with a gap between them", () => {
    const slots = groupedBarSlots(2);
    expect(slots).toHaveLength(2);
    expect(slots[0].offset).toBeCloseTo(-0.25, 10);
    expect(slots[1].offset).toBeCloseTo(0.25, 10);
    // Bars must not overlap: right edge of slot 0 <= left edge of slot 1.
    expect(slots[0].offset + slots[0].halfWidth).toBeLessThanOrEqual(slots[1].offset - slots[1].halfWidth + 1e-9);
  });

  it("keeps three-or-more series non-overlapping and symmetric", () => {
    const slots = groupedBarSlots(3);
    expect(slots).toHaveLength(3);
    // Symmetric around 0.
    expect(slots[0].offset).toBeCloseTo(-slots[2].offset, 10);
    expect(slots[1].offset).toBeCloseTo(0, 10);
    for (let i = 0; i < slots.length - 1; i++) {
      expect(slots[i].offset + slots[i].halfWidth).toBeLessThanOrEqual(
        slots[i + 1].offset - slots[i + 1].halfWidth + 1e-9,
      );
    }
  });
});

describe("stackedSegments / stackedTotal", () => {
  it("accumulates bottom-to-top in series order", () => {
    const series = [seriesStat([10]), seriesStat([20]), seriesStat([5])];
    const segs = stackedSegments(series);
    expect(segs).toEqual([
      { base: 0, top: 10 },
      { base: 10, top: 30 },
      { base: 30, top: 35 },
    ]);
    expect(stackedTotal(series)).toBe(35);
  });

  it("treats a non-finite (empty) group's mean as zero contribution", () => {
    const series = [seriesStat([10]), seriesStat([]), seriesStat([5])];
    const segs = stackedSegments(series);
    expect(segs[1]).toEqual({ base: 10, top: 10 }); // zero-height segment
    expect(segs[2]).toEqual({ base: 10, top: 15 });
    expect(stackedTotal(series)).toBe(15);
  });

  it("returns 0 for an empty series list", () => {
    expect(stackedSegments([])).toEqual([]);
    expect(stackedTotal([])).toBe(0);
  });
});

// BUG-006 site 10: `textLabelsFor` pairs sidecar cell r with row r, which is
// only valid when the two describe the SAME rows. A lazily-loaded Origin book's
// preview breaks that — decimated rows, full-length sidecar — so the resolver
// declines to row-index a sidecar whose length disagrees with the rows.
describe("category labels never come from a sidecar that does not match the rows (BUG-006 site 10)", () => {
  const SIDECAR = { Group: ["A0", "A0", "B1", "B1", "C2", "C2"] };
  const preview = (time: number[], values: number[][]): DataStruct => ({
    time,
    values,
    labels: ["Group"],
    units: [""],
    metadata: { text_columns: SIDECAR, instrument: "PPMS" },
  });

  it("a SAMPLED preview with NO row map falls back to numbers, not confident WRONG names", () => {
    // The measured defect. Pre-guard this returned ["A0","A0","B1"]: every
    // level covered and each internally consistent, so the agreement check
    // passed. The truth is A0/B1/C2. This is now also the NEGATIVE CONTROL for
    // the row map below — an older backend, or a `.dwk` whose map did not
    // survive validation, must keep landing on the numbers.
    const sampled = preview([1, 2, 4, 5], [[0], [1], [2], [2]]);
    const labels = resolveCategoryLabels(sampled, 0, [0, 1, 2]);
    expect(labels).not.toEqual(["A0", "A0", "B1"]);
    expect(labels).toEqual(["0", "1", "2"]);
  });

  it("does NOT delete the sidecar — readers that never row-index it still see it", () => {
    // The producer-side strip this replaced destroyed the sidecar outright,
    // which broke the Inspector's Origin provenance card and
    // lib/projectSearchSidecars.ts's name search — and persisted the loss into
    // the .dwk. Declining to INDEX costs only this one label source.
    const sampled = preview([1, 2, 4, 5], [[0], [1], [2], [2]]);
    resolveCategoryLabels(sampled, 0, [0, 1, 2]);
    expect(sampled.metadata?.["text_columns"]).toEqual(SIDECAR);
    expect(sampled.metadata?.["instrument"]).toBe("PPMS");
  });

  it("a MATCHING sidecar is still used — the guard is not a blanket refusal", () => {
    const resolved = preview([1, 2, 3, 4, 5, 6], [[0], [0], [1], [1], [2], [2]]);
    expect(resolveCategoryLabels(resolved, 0, [0, 1, 2])).toEqual(["A0", "B1", "C2"]);
  });

  it("KNOWN COST: a padding-trimmed preview still degrades to numbers", () => {
    // A trim is a genuine PREFIX whose cells DO line up, but its sidecar is
    // full-length too, and no length test can tell a prefix from a sample. The
    // row map does not help here BY DESIGN: the backend omits it exactly when
    // the rows correspond, so a trimmed preview arrives with nothing to read.
    // Still correct-but-unavailable until the book resolves — a degradation,
    // deliberately preferred over the wrong names above.
    const trimmed = preview([1, 2, 3, 4], [[0], [0], [1], [1]]);
    expect(resolveCategoryLabels(trimmed, 0, [0, 1])).toEqual(["0", "1"]);
  });

  it("a LEVEL TABLE still wins, so a categorical channel keeps real names", () => {
    // `cat_levels` is channel-keyed, not row-indexed, so decimation cannot
    // disturb it and it takes precedence. NOTE this is a narrow claim: an
    // Origin .opj import carries text columns and NO cat_levels, so for the
    // datasets this guard actually affects the fallback IS the numbers above.
    const withTable: DataStruct = {
      ...preview([1, 2, 4, 5], [[0], [1], [2], [2]]),
      cat_levels: { 0: ["Low", "Mid", "High"] },
    };
    expect(resolveCategoryLabels(withTable, 0, [0, 1, 2])).toEqual(["Low", "Mid", "High"]);
  });
});

// Group T: the sampled preview's labels are RECOVERED, not refused, once the
// backend says which rows it kept (`preview.py::decimate_with_alignment` ->
// `LazyBookEntry.preview_rows` -> `metadata.preview_source_rows`). Same 6-row
// book as the block above, so every case here is the measured defect's own
// fixture with one key added.
describe("a sampled preview's category labels come from its row map (BUG-006 site 10, Group T)", () => {
  const SIDECAR = { Group: ["A0", "A0", "B1", "B1", "C2", "C2"] };
  // Rows 1, 2, 4 and 5 of the 6-row book, i.e. levels [0, 1, 2, 2] — the sample
  // whose naive walk produced ["A0","A0","B1"].
  const KEPT = [1, 2, 4, 5];
  const sampled = (map: unknown): DataStruct => ({
    time: [1, 2, 4, 5],
    values: [[0], [1], [2], [2]],
    labels: ["Group"],
    units: [""],
    metadata:
      map === undefined
        ? { text_columns: SIDECAR }
        : { text_columns: SIDECAR, preview_source_rows: map },
  });

  it("resolves the RIGHT label per level — A0/B1/C2, not A0/A0/B1", () => {
    expect(resolveCategoryLabels(sampled(KEPT), 0, [0, 1, 2])).toEqual(["A0", "B1", "C2"]);
  });

  it("reads the map's cell, not row r's — every level is a DIFFERENT cell", () => {
    // The sharper form of the claim above: `rows[r]` and `rows[map[r]]` are
    // different cells for r >= 1 here, so a resolver that quietly kept indexing
    // by r cannot produce this answer. Level 2's label is the give-away: "C2"
    // lives at source rows 4/5, which a 4-row walk over `rows[r]` never reaches.
    const labels = resolveCategoryLabels(sampled(KEPT), 0, [0, 1, 2]);
    expect(labels?.[2]).toBe("C2");
    expect(SIDECAR.Group[2]).toBe("B1"); // what `rows[2]` would have said
    // Level 0's row is kept row 1, not kept row 0 — so an off-by-one in the
    // lookup (`rows[map[r] + 1]`) reads "B1" here and this line catches it.
    expect(labels?.[0]).toBe("A0");
  });

  it("ignores a map of the WRONG LENGTH and degrades to numbers", () => {
    // One entry short of the preview's 4 rows: a hand-edited `.dwk`, or a map
    // saved against a preview that has since been sliced. Unusable — refuse.
    expect(resolveCategoryLabels(sampled([1, 2, 4]), 0, [0, 1, 2])).toEqual(["0", "1", "2"]);
  });

  it("reads an entry past the SIDECAR's end as a blank cell, per entry", () => {
    // Review finding 6. The validator's `sourceRowCount` bound is the PRODUCER's
    // (`book.rows`); the only bound available here is ONE text column's cell
    // count, and an Origin text column is allowed to be shorter than the book —
    // `io/origin_project/opj.py` pads only NUMERIC columns to the block's
    // longest. Bounding the map by it would make every entry past that column's
    // end fatal to the whole map and disable the feature for a shape the
    // unsampled path handles fine, so an out-of-range entry reads `undefined` ->
    // "" -> the blank the walk already skips.
    //
    // The mechanism, spelled out for THIS fixture because the previous version of
    // this comment described one that was false for it: map [1,2,4,6] over
    // preview levels [0,1,2,2] names cells 1 ("A0"), 2 ("B1") and 4 ("C2") for
    // levels 0, 1 and 2, and only the fourth entry — cell 6, past the 6-cell
    // column — is blank. Level 2 is already covered by the third entry, so every
    // level keeps its real name.
    expect(resolveCategoryLabels(sampled([1, 2, 4, 6]), 0, [0, 1, 2])).toEqual(["A0", "B1", "C2"]);
  });

  it("degrades when an out-of-range entry is a level's ONLY cell", () => {
    // The other half of the per-entry rule, so "blank" cannot be read as
    // "harmless": map [1,2,6,7] leaves level 2 with no cell at all (both of its
    // rows point past the column), `levels.every(has)` fails, and the labels fall
    // back to numbers. A blank never invents a name.
    expect(resolveCategoryLabels(sampled([1, 2, 6, 7]), 0, [0, 1, 2])).toEqual(["0", "1", "2"]);
  });

  it("ignores a map with a REPEATED entry — the malformation that would name every level from one cell", () => {
    // Review finding 3. `[0,0,0,0]` is internally CONSISTENT, so the per-level
    // agreement check below cannot catch it: every level reads source row 0's
    // cell and the resolver returned ["A0","A0","A0"] with no sign of trouble.
    // `asPreviewSourceRows` rejects repeats for exactly this case.
    expect(resolveCategoryLabels(sampled([0, 0, 0, 0]), 0, [0, 1, 2])).toEqual(["0", "1", "2"]);
  });

  // These two land on the numbers by TWO routes — rejected by the validator, or
  // accepted and then read as a blank cell that leaves a level uncovered — so
  // they pin the user-visible outcome but cannot prove the validation ran.
  // `lib/rowSidecars.test.ts`'s "rejects every malformed shape" does that.
  it("ignores a NEGATIVE or fractional index", () => {
    expect(resolveCategoryLabels(sampled([-1, 2, 4, 5]), 0, [0, 1, 2])).toEqual(["0", "1", "2"]);
    expect(resolveCategoryLabels(sampled([1.5, 2, 4, 5]), 0, [0, 1, 2])).toEqual(["0", "1", "2"]);
  });

  it("ignores a map that is not an array of numbers at all", () => {
    expect(resolveCategoryLabels(sampled("1,2,4,5"), 0, [0, 1, 2])).toEqual(["0", "1", "2"]);
    expect(resolveCategoryLabels(sampled(["1", "2", "4", "5"]), 0, [0, 1, 2])).toEqual(["0", "1", "2"]);
    expect(resolveCategoryLabels(sampled({ 0: 1 }), 0, [0, 1, 2])).toEqual(["0", "1", "2"]);
  });

  it("is NOT consulted when the sidecar already matches the rows", () => {
    // The length gate on its own terms: a dataset whose sidecar covers exactly
    // its own rows reads its cells straight through, so a map cannot disturb a
    // dataset that does not need one. The map here is a deliberate lie —
    // reversed — and the answer is still the honest one.
    //
    // Which operations can leave a map behind at all is settled in
    // `lib/rowSidecars.ts`, and an earlier version of this comment got it wrong
    // by naming the slice: `withoutRowSidecars` STRIPS the map for the rebuild
    // that concatenates sidecars in its own row space, and `sliceRowSidecars`
    // COMPOSES it rather than leaving a source-space sidecar behind. So this gate
    // is what keeps a hand-edited `.dwk`'s stale map harmless — not what keeps a
    // row operation honest.
    const full: DataStruct = {
      time: [1, 2, 3, 4, 5, 6],
      values: [[0], [0], [1], [1], [2], [2]],
      labels: ["Group"],
      units: [""],
      metadata: { text_columns: SIDECAR, preview_source_rows: [5, 4, 3, 2, 1, 0] },
    };
    expect(resolveCategoryLabels(full, 0, [0, 1, 2])).toEqual(["A0", "B1", "C2"]);
  });

  it("a map cannot rescue a sidecar that genuinely DISAGREES with itself", () => {
    // The per-level agreement check still runs, on the MAPPED cells. Levels
    // [0,0,1,1] over kept rows [0,2,4,5] read "A0","B1","C2","C2", so level 0
    // claims both "A0" and "B1" — the disagreement the check exists to catch. A
    // map buys the right cells, not permission to skip that check.
    const ds: DataStruct = {
      time: [0, 2, 4, 5],
      values: [[0], [0], [1], [1]],
      labels: ["Group"],
      units: [""],
      metadata: { text_columns: SIDECAR, preview_source_rows: [0, 2, 4, 5] },
    };
    expect(resolveCategoryLabels(ds, 0, [0, 1])).toEqual(["0", "1"]);
  });

  it("does not mutate or consume the map — it stays in metadata for the next read", () => {
    const ds = sampled(KEPT);
    resolveCategoryLabels(ds, 0, [0, 1, 2]);
    expect(ds.metadata?.["preview_source_rows"]).toEqual(KEPT);
    expect(ds.metadata?.["text_columns"]).toEqual(SIDECAR);
  });
});
