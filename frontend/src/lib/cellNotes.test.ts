// The cell-notes sidecar model and its row slicer (ROW_RANGE_CONTRACT 7.1).

import { describe, expect, it } from "vitest";

import { CELL_NOTES_KEY, noteAt, noteCount, notesOf, withNotes } from "./cellNotes";
import { metadataFeaturesOf } from "./workspaceMetadataGate";
import { sliceRowSidecars } from "./rowSidecars";

const md = (notes: unknown): Record<string, unknown> => ({ [CELL_NOTES_KEY]: notes, other: 1 });

describe("sliceRowSidecars with notes", () => {
  it("keeps each note on its row: reorder, subset, repeat, and a blank slot (-1) that has none", () => {
    const out = sliceRowSidecars(md({ 0: { 0: "a", 2: "c" }, "-1": { 1: "x" } }), [2, 1, 2, -1, 0]);
    expect(out[CELL_NOTES_KEY]).toEqual({ 0: { 0: "c", 2: "c", 4: "a" }, "-1": { 1: "x" } });
    expect(out.other).toBe(1);
  });

  it("an emptied or malformed sidecar becomes {} (which the v9 gate reads as no notes), never throws", () => {
    for (const bad of [{ 0: { 5: "gone" } }, "junk", [1, 2], null, { 0: [1] }, { 0: { 0: 7, 1: "" } }]) {
      const out = sliceRowSidecars(md(bad), [0, 1]);
      expect(out[CELL_NOTES_KEY]).toEqual({});
      expect(metadataFeaturesOf({ data: { metadata: out } })).toEqual([]);
    }
  });

  it("is untouched when the dataset has no notes", () => {
    expect(CELL_NOTES_KEY in sliceRowSidecars({ a: 1 }, [0])).toBe(false);
  });
});

describe("the model", () => {
  it("reads only well-formed entries", () => {
    expect(notesOf(md({ 0: { 1: "ok", 2: 5, 3: "" }, 1: "bad" }))).toEqual({ 0: { 1: "ok" } });
    expect(noteAt(md({ 0: { 1: "ok" } }), 1, 0)).toBe("ok");
    expect(noteCount(md({ 0: { 1: "a", 2: "b" }, 3: { 0: "c" } }))).toBe(3);
  });

  it("withNotes: sets, replaces, clears, keeps what fits past the cap, and drops the key with the last note", () => {
    const one = withNotes({}, [{ row: 0, col: 0, text: "a" }]);
    expect(one.applied).toBe(1);
    expect(withNotes(one.metadata, [{ row: 0, col: 0, text: "a" }]).applied).toBe(0); // no change, same object
    const gone = withNotes(one.metadata, [{ row: 0, col: 0, text: null }]);
    expect(CELL_NOTES_KEY in gone.metadata).toBe(false);
    const big: Record<string, string> = {};
    for (let i = 0; i < 1999; i += 1) big[String(i)] = "n";
    const res = withNotes(md({ 0: big }), [{ row: 5000, col: 0, text: "fits" }, { row: 5001, col: 0, text: "over" }]);
    expect(res.applied).toBe(1);
    expect(res.refused).toMatch(/at most 2,000 notes/);
  });
});
