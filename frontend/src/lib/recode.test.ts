import { describe, expect, it } from "vitest";

import {
  buildRecodePreview,
  mappingFromFindReplace,
  recodeColumnValues,
  resolveLevel,
  resolveRecodeChannel,
  resolveRecodeMapping,
  type RecodeMapping,
} from "./recode";

describe("resolveLevel", () => {
  it("passes an unmapped level through unchanged (identity)", () => {
    const m: RecodeMapping = { groups: [{ newLabel: "Pass", from: ["Pass", "OK"] }] };
    expect(resolveLevel(m, "Fail")).toBe("Fail");
  });
  it("resolves a merged level to its group's newLabel", () => {
    const m: RecodeMapping = { groups: [{ newLabel: "Pass", from: ["Pass", "OK"] }] };
    expect(resolveLevel(m, "OK")).toBe("Pass");
    expect(resolveLevel(m, "Pass")).toBe("Pass");
  });
});

describe("buildRecodePreview", () => {
  it("builds one row per old level and a deduped new-level table in first-appearance order", () => {
    const oldLevels = ["Red", "Green", "Blue", "Crimson"];
    const mapping: RecodeMapping = { groups: [{ newLabel: "Red", from: ["Red", "Crimson"] }] };
    const preview = buildRecodePreview(oldLevels, mapping);
    expect(preview.rows).toEqual([
      { oldLevel: "Red", newLevel: "Red" },
      { oldLevel: "Green", newLevel: "Green" },
      { oldLevel: "Blue", newLevel: "Blue" },
      { oldLevel: "Crimson", newLevel: "Red" },
    ]);
    // "Red" appears first (position 0), so it keeps that slot in the new table
    // even though "Crimson" (which also maps to it) appears later.
    expect(preview.newLevels).toEqual(["Red", "Green", "Blue"]);
  });

  it("a rename (single from, different text) still produces one preview row + one new level", () => {
    const preview = buildRecodePreview(["Y", "N"], { groups: [{ newLabel: "Yes", from: ["Y"] }] });
    expect(preview.rows[0]).toEqual({ oldLevel: "Y", newLevel: "Yes" });
    expect(preview.newLevels).toEqual(["Yes", "N"]);
  });
});

describe("recodeColumnValues — invertibility (P1.4 pin)", () => {
  it("every row's new code recovers EXACTLY the resolved label via levels[code]", () => {
    const sourceLevels = ["Pass", "OK", "Fail", "Retry"];
    const sourceValues = [0, 1, 2, 3, 1, 0];
    const mapping: RecodeMapping = { groups: [{ newLabel: "Pass", from: ["Pass", "OK"] }] };
    const { codes, levels } = recodeColumnValues(sourceValues, sourceLevels, mapping);
    for (let i = 0; i < sourceValues.length; i++) {
      const expectedLabel = resolveLevel(mapping, sourceLevels[sourceValues[i]]);
      expect(levels[codes[i]]).toBe(expectedLabel); // round-trips exactly
    }
    // The merge collapsed Pass/OK onto the same code (lossy at the semantic
    // level, by design), but the new table itself is fully invertible.
    expect(codes[0]).toBe(codes[1]); // Pass and OK now share a code
    expect(new Set(levels).size).toBe(levels.length); // no duplicate labels
  });

  it("a missing (NaN) source code stays missing in the recode", () => {
    const { codes } = recodeColumnValues([Number.NaN], ["A", "B"], { groups: [] });
    expect(codes[0]).toBeNaN();
  });

  it("an out-of-range or non-integer source code degrades to NaN, never throws", () => {
    const r1 = recodeColumnValues([99], ["A", "B"], { groups: [] });
    expect(r1.codes[0]).toBeNaN();
    const r2 = recodeColumnValues([1.5], ["A", "B"], { groups: [] });
    expect(r2.codes[0]).toBeNaN();
  });

  it("an identity mapping (no groups) reproduces the source table verbatim", () => {
    const sourceLevels = ["A", "B", "C"];
    const { codes, levels } = recodeColumnValues([0, 1, 2, 1], sourceLevels, { groups: [] });
    expect(levels).toEqual(sourceLevels);
    expect(codes).toEqual([0, 1, 2, 1]);
  });
});

describe("mappingFromFindReplace (J2: plain find-replace over text cells)", () => {
  it("builds a group only for levels containing the search text", () => {
    const m = mappingFromFindReplace(["Sample A", "Sample B", "Blank"], "Sample ", "Spec-");
    expect(m.groups).toEqual([
      { newLabel: "Spec-A", from: ["Sample A"] },
      { newLabel: "Spec-B", from: ["Sample B"] },
    ]);
  });

  it("merges levels that collapse onto the same replaced text into one group", () => {
    // Both "xx" and "x" strip every "x" down to the SAME empty string —
    // a genuine merge produced by a single find/replace pass.
    const m = mappingFromFindReplace(["xx", "x", "y"], "x", "");
    expect(m.groups).toEqual([{ newLabel: "", from: ["xx", "x"] }]);
  });

  it("an empty search string is a no-op mapping", () => {
    expect(mappingFromFindReplace(["A", "B"], "", "x").groups).toEqual([]);
  });

  it("case-insensitive mode matches regardless of case", () => {
    const m = mappingFromFindReplace(["YES", "yes", "no"], "yes", "Y", { caseSensitive: false });
    expect(m.groups).toEqual([{ newLabel: "Y", from: ["YES", "yes"] }]);
  });
});

describe("resolveRecodeMapping — refusal-with-explanation on reapply mismatch (J2 item 3)", () => {
  const mapping: RecodeMapping = { groups: [{ newLabel: "Pass", from: ["Pass", "OK"] }] };

  it("ok:true when every named old level exists on the target", () => {
    expect(resolveRecodeMapping(mapping, ["Pass", "OK", "Fail"])).toEqual({ ok: true });
  });

  it("ok:true when the target has EXTRA levels the mapping never mentions", () => {
    expect(resolveRecodeMapping(mapping, ["Pass", "OK", "Fail", "Retry", "Skipped"])).toEqual({ ok: true });
  });

  it("refuses the whole apply, naming every unmatched level, when the target lacks one", () => {
    const r = resolveRecodeMapping(mapping, ["Pass", "Fail"]); // missing "OK"
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.unmatched).toEqual(["OK"]);
      expect(r.reason).toMatch(/OK/);
    }
  });

  it("names every unmatched level, not just the first, and never partially resolves", () => {
    const wide: RecodeMapping = {
      groups: [
        { newLabel: "A", from: ["A1", "A2"] },
        { newLabel: "B", from: ["B1"] },
      ],
    };
    const r = resolveRecodeMapping(wide, ["A1"]); // A2 and B1 both missing
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.unmatched).toEqual(["A2", "B1"]);
  });
});

describe("resolveRecodeChannel (DEFECT B, Sol audit P1-3)", () => {
  it("unchanged: the label at `channel` still matches openLabel", () => {
    const r = resolveRecodeChannel(["A", "B", "C"], 1, "B");
    expect(r).toEqual({ ok: true, channel: 1 });
  });

  it("retargets to the unique column that now carries openLabel", () => {
    // "B" shifted from index 1 to index 0; a different column now sits at 1.
    const r = resolveRecodeChannel(["B", "X", "C"], 1, "B");
    expect(r).toEqual({ ok: true, channel: 0 });
  });

  it("refuses when openLabel exists nowhere anymore", () => {
    const r = resolveRecodeChannel(["A", "X", "C"], 1, "B");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/"B".*no longer exists/);
  });

  it("refuses (never guesses) when openLabel is now ambiguous", () => {
    const r = resolveRecodeChannel(["B", "X", "B"], 1, "B");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/ambiguous/);
  });
});
