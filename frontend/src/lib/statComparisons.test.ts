// Significance marks, pure part (gap audit 8 lane SIG): the star thresholds,
// the p text, the note naming the test and correction, the refusals, and the
// compact-letter display (insert-absorb).

import { describe, expect, it } from "vitest";

import { sanitizeStatMarks, sanitizeStatMarksByMode } from "./plotviewSanitize";
import {
  bracketLabel, buildComparisons, compactLetters, compareNote, formatP, refusal, starsOf, type PairP,
} from "./statComparisons";
import { resolveStatMarks } from "./statMarks";

const pair = (a: number, b: number, p: number): PairP => ({ a, b, p });

describe("stars and p text", () => {
  it("uses the documented thresholds, none at or above alpha", () => {
    expect(starsOf(0.049)).toBe("*");
    expect(starsOf(0.05)).toBe("");
    expect(starsOf(0.2)).toBe("");
    expect(starsOf(0.0099)).toBe("**");
    expect(starsOf(0.00099)).toBe("***");
    expect(starsOf(0.00009)).toBe("****");
    expect(starsOf(NaN)).toBe("");
  });

  it("shows the exact p only when asked, to 2 significant digits", () => {
    expect(bracketLabel(0.0042, false)).toBe("**");
    expect(bracketLabel(0.0042, true)).toBe("** p=0.0042");
    expect(formatP(0.03456)).toBe("0.035");
    expect(formatP(0.00001)).toBe("<0.0001");
  });
});

describe("the note names the test and the correction", () => {
  it("says Tukey, adjusted, familywise alpha", () => {
    const n = compareNote("tukey", "brackets", null);
    expect(n).toContain("Tukey HSD");
    expect(n).toContain("p adjusted");
    expect(n).toContain("familywise alpha = 0.05");
    expect(n).toContain("n.s. not drawn");
  });
  it("names the Dunnett control, truncating a long label, and the letters rule", () => {
    expect(compareNote("dunnett", "brackets", "ctrl")).toContain('Dunnett vs control "ctrl"');
    expect(compareNote("dunnett", "brackets", "x".repeat(40))).toContain("...");
    expect(compareNote("tukey", "letters", null)).toContain("groups sharing a letter do not differ");
  });
  it("is ASCII (matplotlib typesets it)", () => {
    for (const m of ["tukey", "dunnett"] as const) {
      for (const d of ["brackets", "letters"] as const) expect(/^[\x20-\x7e]*$/.test(compareNote(m, d, "c"))).toBe(true);
    }
  });
});

describe("refusals fail closed", () => {
  it("refuses letters with Dunnett, allows the other pairings", () => {
    expect(refusal("dunnett", "letters")).toMatch(/Tukey/);
    expect(refusal("tukey", "letters")).toBeNull();
    expect(refusal("dunnett", "brackets")).toBeNull();
    expect(buildComparisons("dunnett", "letters", false, [1, 2], [pair(0, 1, 0.01)], "a")).toEqual({
      error: expect.stringContaining("Tukey"),
    });
  });
});

describe("compact letter display", () => {
  it("gives every group its own letter when all pairs differ, highest mean first", () => {
    const means = [1, 3, 2];
    const pairs = [pair(0, 1, 0.001), pair(0, 2, 0.001), pair(1, 2, 0.001)];
    expect(compactLetters(means, pairs)).toEqual(["c", "a", "b"]);
  });
  it("gives one shared letter when nothing is significant", () => {
    expect(compactLetters([1, 2, 3], [pair(0, 1, 0.5), pair(0, 2, 0.4), pair(1, 2, 0.9)])).toEqual(["a", "a", "a"]);
  });
  it("shares a letter across overlapping non-differences (a, ab, b)", () => {
    // 0 vs 2 differ; 0~1 and 1~2 do not. Means high -> low: 2 (a), 1, 0.
    const out = compactLetters([1, 2, 3], [pair(0, 1, 0.5), pair(0, 2, 0.001), pair(1, 2, 0.5)]);
    expect(out).toEqual(["b", "ab", "a"]);
  });
  it("never lets a significant pair share a letter, and every n.s. pair shares one", () => {
    const means = [5, 4, 3, 2, 1];
    const sig = new Set(["0-3", "0-4", "1-4"]);
    const pairs: PairP[] = [];
    for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) pairs.push(pair(i, j, sig.has(`${i}-${j}`) ? 0.001 : 0.5));
    const letters = compactLetters(means, pairs)!;
    const share = (i: number, j: number) => [...letters[i]].some((c) => letters[j].includes(c));
    for (const p of pairs) expect(share(p.a, p.b)).toBe(p.p >= 0.05);
  });
  it("treats an untested pair as not significant", () => {
    expect(compactLetters([1, 2], [])).toEqual(["a", "a"]);
  });
});

describe("persisted choice", () => {
  it("resolves to off / Tukey / no control / no exact p by default", () => {
    const r = resolveStatMarks("box", null);
    expect([r.comparisons, r.compareMethod, r.compareControl, r.compareExact]).toEqual(["off", "tukey", null, false]);
  });
  it("is kept per mode and sanitized at the .dwk boundary", () => {
    expect(sanitizeStatMarks({ comparisons: "letters", compareMethod: "dunnett", compareControl: "ctrl", compareExact: true })).toEqual({
      comparisons: "letters", compareMethod: "dunnett", compareControl: "ctrl", compareExact: true,
    });
    expect(sanitizeStatMarks({ comparisons: "bogus", compareMethod: "x", compareControl: 3, compareExact: "yes" })).toEqual({});
    expect(sanitizeStatMarksByMode({ box: { comparisons: "brackets" } })).toEqual({ box: { comparisons: "brackets" } });
  });
});

describe("review hardening", () => {
  it("refuses letters that would need more than 26 columns instead of reusing a letter", () => {
    const k = 30;
    const means = Array.from({ length: k }, (_, i) => i);
    const pairs: PairP[] = [];
    for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) pairs.push(pair(i, j, 0.001));
    expect(compactLetters(means, pairs)).toBeNull();
    expect(buildComparisons("tukey", "letters", false, means, pairs, null)).toEqual({ error: expect.stringContaining("brackets") });
    // brackets still work for the same data
    expect("error" in buildComparisons("tukey", "brackets", false, means, pairs, null)).toBe(false);
  });
});
