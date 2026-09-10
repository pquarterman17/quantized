import { describe, expect, it } from "vitest";

import { mergeDatasets } from "./merge";
import type { DataStruct } from "./types";

const a: DataStruct = {
  time: [1, 2],
  values: [[10], [20]],
  labels: ["M"],
  units: ["emu"],
  metadata: { source: "a.dat" },
};
const b: DataStruct = {
  time: [3, 4],
  values: [[30], [40]],
  labels: ["M"],
  units: ["emu"],
  metadata: {},
};

describe("mergeDatasets", () => {
  it("concatenates rows in input order, keeping the first's labels/units", () => {
    const m = mergeDatasets([a, b], ["a.dat", "b.dat"]);
    expect(m.time).toEqual([1, 2, 3, 4]);
    expect(m.values).toEqual([[10], [20], [30], [40]]);
    expect(m.labels).toEqual(["M"]);
    expect(m.units).toEqual(["emu"]);
    expect(m.metadata.merged_from).toBe("a.dat + b.dat");
    expect(m.metadata.merged_count).toBe(2);
  });

  it("does not alias source rows", () => {
    const m = mergeDatasets([a, b], ["a", "b"]);
    m.values[0][0] = 999;
    expect(a.values[0][0]).toBe(10); // source untouched
  });

  it("throws on fewer than two datasets", () => {
    expect(() => mergeDatasets([a], ["a"])).toThrow(/at least 2/);
  });

  it("throws on a column-count mismatch", () => {
    const wide: DataStruct = { ...a, labels: ["M", "T"], units: ["emu", "K"], values: [[1, 2], [3, 4]] };
    expect(() => mergeDatasets([a, wide], ["a", "wide"])).toThrow(/column-count/);
  });
});

// P1.4 review P2-1's placeholder ("carry the level table iff every merged
// dataset has an IDENTICAL, same-order table; on any mismatch drop that
// channel entirely") is superseded by P1.5's real conflict resolution below:
// a channel whose datasets ALL carry SOME table for it (possibly differing)
// merges onto a coherent UNION table, remapping every dataset's own codes
// losslessly (lib/merge.ts's `planChannel`/`remapFor`). The one remaining
// drop case is a channel with NO table at all on at least one dataset --
// there is nothing to remap FROM (its raw values were never codes into
// anything), so it still drops, unchanged from the P1.4 ruling.
describe("mergeDatasets — cat_levels (P1.5 real conflict resolution)", () => {
  const catA: DataStruct = {
    time: [1, 2],
    values: [[10, 0], [20, 1]],
    labels: ["M", "Region"],
    units: ["emu", ""],
    metadata: {},
    cat_levels: { 1: ["North", "South"] },
  };
  const catBIdentical: DataStruct = {
    time: [3, 4],
    values: [[30, 1], [40, 0]],
    labels: ["M", "Region"],
    units: ["emu", ""],
    metadata: {},
    cat_levels: { 1: ["North", "South"] },
  };
  const catBDiffering: DataStruct = {
    ...catBIdentical,
    cat_levels: { 1: ["East", "West"] },
  };
  const catBMissing: DataStruct = {
    ...catBIdentical,
    cat_levels: undefined,
  };
  const catBReordered: DataStruct = {
    ...catBIdentical,
    cat_levels: { 1: ["South", "North"] }, // same strings, different ORDER -- still a mismatch
  };

  it("carries the level table forward when every dataset agrees (identical, same order)", () => {
    const m = mergeDatasets([catA, catBIdentical], ["a", "b"]);
    expect(m.cat_levels).toEqual({ 1: ["North", "South"] });
  });

  it("remaps codes onto a union table when datasets disagree on the level strings", () => {
    // catA: North/South (codes 0/1, rows [0,1]). catBDiffering: East/West of
    // its OWN (codes 1/0 = West/East, rows [1,0]). Union = catA's own order
    // first, then catB's genuinely NEW strings appended: [North,South,East,West].
    // catA needs no remap (its table already IS the union's prefix); catB's
    // West(1)->3, East(0)->2.
    const m = mergeDatasets([catA, catBDiffering], ["a", "b"]);
    expect(m.cat_levels).toEqual({ 1: ["North", "South", "East", "West"] });
    expect(m.values.map((row) => row[1])).toEqual([0, 1, 3, 2]);
  });

  it("drops that channel's levels when one dataset has no level table for it at all", () => {
    // The one case that still drops: catBMissing's raw values were never
    // codes into anything, so there is nothing to remap them FROM.
    const m = mergeDatasets([catA, catBMissing], ["a", "b"]);
    expect(m.cat_levels?.[1]).toBeUndefined();
  });

  it("remaps a reordered-but-same-strings table onto the canonical (no-new-strings) union", () => {
    // catBReordered has NO string catA lacks, so the union collapses back to
    // catA's own table -- catB's codes get canonically relabeled onto it
    // (North/South swapped -> remapped back to catA's own order).
    const m = mergeDatasets([catA, catBReordered], ["a", "b"]);
    expect(m.cat_levels).toEqual({ 1: ["North", "South"] });
    expect(m.values.map((row) => row[1])).toEqual([0, 1, 0, 1]);
  });

  it("merges multiple categorical channels independently -- one agrees, one needs a remap", () => {
    const wideA: DataStruct = {
      time: [1],
      values: [[0, 0]],
      labels: ["Region", "Lot"],
      units: ["", ""],
      metadata: {},
      cat_levels: { 0: ["North", "South"], 1: ["L1", "L2"] },
    };
    const wideB: DataStruct = {
      time: [2],
      values: [[1, 1]], // Region=South(1); Lot=L1(1) under wideB's OWN reordered table
      labels: ["Region", "Lot"],
      units: ["", ""],
      metadata: {},
      cat_levels: { 0: ["North", "South"], 1: ["L2", "L1"] }, // channel 1 disagrees (order)
    };
    const m = mergeDatasets([wideA, wideB], ["a", "b"]);
    expect(m.cat_levels).toEqual({ 0: ["North", "South"], 1: ["L1", "L2"] });
    // channel 0 (agrees) unchanged: [0, 1]; channel 1 (remapped) L1(wideB code
    // 1) -> canonical index 0: [0, 0].
    expect(m.values).toEqual([[0, 0], [1, 0]]);
  });

  it("plain numeric datasets (no cat_levels anywhere) merge with no cat_levels key", () => {
    const m = mergeDatasets([a, b], ["a", "b"]);
    expect("cat_levels" in m).toBe(false);
  });

  // BUG-006 site 8: `{...datasets[0].metadata}` dropped datasets 1..N's
  // row-indexed sidecars AND, when dataset 0's ran longer than its own rows,
  // pushed its trailing cells onto dataset 1's rows.
  describe("row-indexed metadata sidecars concatenate across every input", () => {
    const withText = (
      time: number[],
      cells: Record<string, string[]>,
      extra: Record<string, unknown> = {},
    ): DataStruct => ({
      time,
      values: time.map((t) => [t * 10]),
      labels: ["M"],
      units: ["emu"],
      metadata: { text_columns: cells, ...extra },
    });

    it("keeps every input's cells, in row order", () => {
      const m = mergeDatasets(
        [withText([1, 2], { Op: ["p", "q"] }), withText([3, 4], { Op: ["r", "s"] })],
        ["a", "b"],
      );
      expect(m.time).toEqual([1, 2, 3, 4]);
      expect((m.metadata["text_columns"] as Record<string, string[]>).Op).toEqual(["p", "q", "r", "s"]);
    });

    it("no longer DROPS the second dataset's sidecar", () => {
      const m = mergeDatasets([withText([1, 2], {}), withText([3, 4], { Op: ["r", "s"] })], ["a", "b"]);
      // Before: dataset 0 had no `text_columns`, so the merge had none at all
      // and "r"/"s" vanished.
      expect((m.metadata["text_columns"] as Record<string, string[]>).Op).toEqual(["", "", "r", "s"]);
    });

    it("keeps dataset 0's OVERFLOW cells AND keeps them off dataset 1's rows", () => {
      // The ragged case: A's sidecar has 5 cells for 2 numeric rows. Two wrong
      // answers were shipped before this one. First, A's array verbatim, so B's
      // rows displayed a2/a3. Then, sized by `time.length`, which put B's cells
      // at index 2 and DELETED a2/a3/a4 — the truncation `store/cellEdit.ts`
      // already forbade. A's span is 5, so it contributes 5 rows to both halves.
      const m = mergeDatasets(
        [withText([1, 2], { Op: ["a0", "a1", "a2", "a3", "a4"] }), withText([3, 4], { Op: ["b0", "b1"] })],
        ["a", "b"],
      );
      expect((m.metadata["text_columns"] as Record<string, string[]>).Op).toEqual([
        "a0", "a1", "a2", "a3", "a4", "b0", "b1",
      ]);
      // The numeric half is padded to the same span, so B's numbers are at 5/6 —
      // the same rows as b0/b1, which is the whole point.
      expect(m.time).toHaveLength(7);
      expect(m.time[5]).toBe(3);
      expect(m.time[6]).toBe(4);
      expect(m.time.slice(2, 5).every((t) => Number.isNaN(t))).toBe(true);
    });

    it("two TEXT-ONLY books keep both books' cells", () => {
      // Review-round regression. Both have zero numeric rows, so under
      // `time.length` sizing both spans were 0, every rebuilt column came out
      // empty, `concatRowSidecars` omitted the key — and the spread-then-
      // overwrite then left dataset 0's ORIGINAL sidecar standing. Book 2's
      // cells were simply gone: the pre-fix behaviour, shipped green.
      const textOnly = (cells: string[]): DataStruct => ({
        time: [],
        values: [],
        labels: [],
        units: [],
        metadata: { origin_text_columns: { A: cells } },
      });
      const m = mergeDatasets([textOnly(["b0-r0", "b0-r1"]), textOnly(["b1-r0", "b1-r1"])], ["one", "two"]);
      expect((m.metadata["origin_text_columns"] as Record<string, string[]>).A).toEqual([
        "b0-r0", "b0-r1", "b1-r0", "b1-r1",
      ]);
    });

    it("each PAD row is its own array, not one shared reference", () => {
      // The comment in merge.ts promised this ("A fresh row per pad row — never
      // one shared array"); nothing tested it. Hoisting a single `padRow` shared
      // by every pad row left 339 files / 6,323 tests green — a doc promise with
      // no test, which is the exact discipline CLAUDE.md names. Asserted through a
      // WRITE, so it fails the way a user would see it.
      const m = mergeDatasets(
        [withText([1, 2], { Op: ["a0", "a1", "a2", "a3", "a4"] }), withText([3, 4], {})],
        ["a", "b"],
      );
      const pads = [m.values[2], m.values[3], m.values[4]];
      expect(pads[0]).not.toBe(pads[1]);
      expect(pads[1]).not.toBe(pads[2]);
      pads[0][0] = 42;
      expect(m.values[3][0]).toBeNaN(); // a shared row would have taken the 42
      expect(m.values[4][0]).toBeNaN();
    });

    it("a CORRUPTED sidecar on dataset 0 does not survive onto the merged grid", () => {
      // This is the case the strip actually earns its place on, and finding it
      // took a sabotage: with per-part spans in place, every ordinary case emits
      // the key and the overwrite alone would have sufficed. A corrupted
      // (non-`{name: array}`) sidecar is skipped for NAME collection, so no key
      // is emitted — and a plain spread then carried dataset 0's bare array
      // through onto a grid with twice its rows. Measured: without the strip,
      // `text_columns: ["bare","array","corrupted"]` survives on a 4-row merge.
      const corrupted: DataStruct = {
        ...a,
        metadata: { text_columns: ["bare", "array", "corrupted"] as unknown as Record<string, string[]> },
      };
      const m = mergeDatasets([corrupted, { ...b, metadata: {} }], ["a", "b"]);
      expect(m.metadata["text_columns"]).toBeUndefined();
    });

    it("a stale sidecar cannot survive when the rebuild contributes nothing", () => {
      // The other half of the same bug, and the nastier one: dataset 0's
      // IN-RANGE cells are blank while an overflow cell is not. The all-blank
      // prune dropped the rebuilt column, the key was omitted, and dataset 0's
      // untouched array came through — putting "SAMPLE-B7" on what is now
      // dataset 1's first row. Dataset 0's keys are stripped before the rebuild
      // now, so an omitted key means ABSENT, never "inherited".
      const m = mergeDatasets(
        [withText([1, 2], { Op: ["", "", "SAMPLE-B7"] }), withText([3, 4], {})],
        ["a", "b"],
      );
      const cols = m.metadata["text_columns"] as Record<string, string[]> | undefined;
      // Whatever survives, "SAMPLE-B7" must not be sitting on dataset 1's rows
      // (indices 3 and 4 of the 5-row output: span 3 for A, then B's two).
      expect(cols?.Op?.[3]).not.toBe("SAMPLE-B7");
      expect(cols?.Op?.[4]).not.toBe("SAMPLE-B7");
      expect(cols?.Op?.[2]).toBe("SAMPLE-B7"); // still on its OWN row
    });

    it("unions differently-named columns, blank where an input lacks one", () => {
      const m = mergeDatasets(
        [withText([1, 2], { Op: ["p", "q"] }), withText([3, 4], { Sample: ["x", "y"] })],
        ["a", "b"],
      );
      const cols = m.metadata["text_columns"] as Record<string, string[]>;
      expect(cols.Op).toEqual(["p", "q", "", ""]);
      expect(cols.Sample).toEqual(["", "", "x", "y"]);
    });

    it("covers the origin_* spellings too", () => {
      const m = mergeDatasets(
        [
          { ...a, metadata: { origin_text_columns: { S: ["s0", "s1"] } } },
          { ...b, metadata: { origin_report_sheets: { R: ["r0", "r1"] } } },
        ],
        ["a", "b"],
      );
      expect((m.metadata["origin_text_columns"] as Record<string, string[]>).S).toEqual(["s0", "s1", "", ""]);
      expect((m.metadata["origin_report_sheets"] as Record<string, string[]>).R).toEqual(["", "", "r0", "r1"]);
    });

    it("still inherits dataset 0's FILE-level metadata", () => {
      const m = mergeDatasets(
        [withText([1, 2], { Op: ["p", "q"] }, { source: "a.dat" }), withText([3, 4], { Op: ["r", "s"] })],
        ["a", "b"],
      );
      expect(m.metadata["source"]).toBe("a.dat");
      expect(m.metadata["merged_count"]).toBe(2);
    });

    it("emits no sidecar key at all when no input carries one", () => {
      const m = mergeDatasets([a, b], ["a", "b"]);
      expect("text_columns" in m.metadata).toBe(false);
    });
  });
});

// Group O-2: a `level_order` names CODES, and a union table renumbers them.
describe("merge carries the level order through the code remap", () => {
  function ds(levels: string[], codes: number[], order?: number[]): DataStruct {
    return {
      time: codes.map((_, i) => i),
      values: codes.map((c) => [c]),
      labels: ["sample"],
      units: [""],
      metadata: {},
      cat_levels: { 0: levels },
      ...(order ? { level_order: { 0: order } } : {}),
    };
  }

  // THE COUNTEREXAMPLE that a review round found to the "dataset 0's codes
  // never move" argument, and the reason the remap in mergeDatasets is NOT dead
  // code. A repeated level STRING in dataset 0's own table makes the union
  // de-duplicate it, so dataset 0's later codes shift down.
  it("remaps dataset 0's order when a REPEATED level string shifts its own codes", () => {
    const a = ds(["A", "A", "B"], [0, 1, 2], [2, 1, 0]);
    const b = ds(["C"], [0]);
    const merged = mergeDatasets([a, b], ["a", "b"]);
    expect(merged.cat_levels![0]).toEqual(["A", "B", "C"]);
    // Dataset 0's rows prove its codes moved: 0,1,2 -> 0,0,1.
    expect(merged.values.slice(0, 3)).toEqual([[0], [0], [1]]);
    // The order must follow. Carried verbatim it would read [2,1,0] = C,B,A —
    // naming dataset 1's level. Remapped it is [1,0] = B,A, which is what the
    // user actually chose (their two distinct levels, in their order).
    const union = merged.cat_levels![0];
    expect(merged.level_order![0].map((c) => union[c])).toEqual(["B", "A"]);
  });

  // THE INVARIANT that makes carrying dataset 0's order safe FOR UNIQUE TABLES. `planChannel`
  // builds the union starting from `tables[0]` in its own order, so dataset 0's
  // levels keep their indices. Asserted directly because the alternative — a
  // "defensive" remap in mergeDatasets — was dead code that no test could hold
  // honest (sabotage: deleting it left everything green). If the union
  // construction ever changes so dataset 0's codes DO move, this fails and the
  // remap becomes genuinely necessary.
  it("dataset 0's codes are never renumbered when its own levels are unique", () => {
    const a = ds(["Low", "High"], [0, 1]);
    const b = ds(["Med", "High", "Extra"], [0, 1, 2]);
    const merged = mergeDatasets([a, b], ["a", "b"]);
    const union = merged.cat_levels![0];
    // Every level of dataset 0 sits at the SAME index in the union.
    a.cat_levels![0].forEach((label, code) => {
      expect(union[code], `dataset 0's "${label}" moved from code ${code}`).toBe(label);
    });
    // And dataset 0's own rows kept their raw codes through the merge.
    expect(merged.values.slice(0, 2)).toEqual([[0], [1]]);
  });

  it("keeps the user's order pointing at the same LEVELS across a union merge", () => {
    // A: [Low, High] codes 0,1 — user order [High, Low] = [1, 0].
    // B: [Med, High] — the union appends Med, so B's codes move, and A's may
    // too depending on the union's construction. Whatever the union is, the
    // order must still name the SAME LEVELS by their new codes.
    const a = ds(["Low", "High"], [0, 1], [1, 0]);
    const b = ds(["Med", "High"], [0, 1]);
    const merged = mergeDatasets([a, b], ["a", "b"]);
    const union = merged.cat_levels![0];
    const orderedLabels = merged.level_order![0].map((c) => union[c]);
    expect(orderedLabels).toEqual(["High", "Low"]); // the user's order, by NAME
  });

  it("keeps the order untouched when every table already agrees (no remap built)", () => {
    const a = ds(["Low", "High"], [0, 1], [1, 0]);
    const b = ds(["Low", "High"], [0, 1]);
    expect(mergeDatasets([a, b], ["a", "b"]).level_order).toEqual({ 0: [1, 0] });
  });

  it("takes dataset 0's order and ignores the others' (deterministic, documented)", () => {
    const a = ds(["Low", "High"], [0, 1], [1, 0]);
    const b = ds(["Low", "High"], [0, 1], [0, 1]);
    expect(mergeDatasets([a, b], ["a", "b"]).level_order).toEqual({ 0: [1, 0] });
  });

  it("emits no level_order at all when dataset 0 has none", () => {
    const merged = mergeDatasets([ds(["Low", "High"], [0, 1]), ds(["Low", "High"], [0, 1], [1, 0])], ["a", "b"]);
    expect("level_order" in merged).toBe(false);
  });
});
