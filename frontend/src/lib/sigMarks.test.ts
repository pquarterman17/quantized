// Significance marks from supplied p-values: thresholds by hand, the p text,
// the footnote, and the saved shape.

import { describe, expect, it } from "vitest";

import { sanitizeStatMarks } from "./plotviewSanitize";
import { DEFAULT_SIG_LEVELS, levelsProblem, markFor, normalizeSig, pText, sigLabel, sigNote } from "./sigMarks";
import { resolveStatMarks } from "./statMarks";

const L = [...DEFAULT_SIG_LEVELS];
const src = { kind: "result", resultId: "r1" };

describe("thresholds (strictly below the cut-off)", () => {
  it.each([
    [0.0004, "***"], [0.001, "**"], [0.0099, "**"], [0.01, "*"], [0.049, "*"], [0.05, null], [0.4, null], [0, "***"],
  ])("p = %s -> %s", (p, mark) => expect(markFor(p, L)).toBe(mark));

  it("uses the user's own marks and cut-offs, in any listing order", () => {
    const own = [{ mark: "+", below: 0.1 }, { mark: "++", below: 0.02 }];
    expect(markFor(0.15, own)).toBeNull();
    expect(markFor(0.05, own)).toBe("+");
    expect(markFor(0.01, [...own].reverse())).toBe("++");
  });

  it("names a pair 'ns' only when ns is shown, and the p itself when asked", () => {
    const base = { levels: L, showP: false, showNs: false };
    expect(sigLabel(0.2, base)).toBeNull();
    expect(sigLabel(0.2, { ...base, showNs: true })).toBe("ns");
    expect(sigLabel(0.012, { ...base, showP: true })).toBe("p = 0.012");
    expect(sigLabel(0.2, { ...base, showP: true })).toBeNull();
    expect(sigLabel(0.2, { ...base, showP: true, showNs: true })).toBe("p = 0.2");
    expect(sigLabel(0.00002, { ...base, showP: true })).toBe("p < 0.0001");
    expect(pText(0.03456)).toBe("p = 0.035");
  });

  it("refuses a bad threshold list", () => {
    expect(levelsProblem(L)).toBeNull();
    expect(levelsProblem([])).toMatch(/1 to 4/);
    expect(levelsProblem([{ mark: "*", below: 0 }])).toMatch(/above 0/);
    expect(levelsProblem([{ mark: "*", below: 1.5 }])).toMatch(/at most 1/);
    expect(levelsProblem([{ mark: "", below: 0.05 }])).toMatch(/mark/);
    expect(levelsProblem([{ mark: " *", below: 0.05 }])).toMatch(/space/);
    expect(levelsProblem([{ mark: "*", below: 0.01 }, { mark: "**", below: 0.05 }])).toMatch(/fall/);
  });
});

describe("the footnote", () => {
  it("says where the p-values came from and what the marks mean", () => {
    expect(sigNote("worksheet pairs", { levels: L, showP: false, showNs: false }))
      .toBe("p-values from worksheet pairs; * p<0.05 ** p<0.01 *** p<0.001; ns not drawn");
    expect(sigNote("x", { levels: L, showP: true, showNs: true })).toBe("p-values from x; p-values shown; ns = not significant");
    expect(sigNote("y".repeat(500), { levels: L, showP: false, showNs: false }).length).toBeLessThanOrEqual(300);
  });
});

describe("the saved shape", () => {
  it("fills defaults, and refuses anything malformed rather than guessing", () => {
    expect(normalizeSig({ source: src })).toEqual({ source: src, levels: L, showP: false, showNs: false });
    expect(normalizeSig({ source: { kind: "sheet", datasetId: "d", a: 0, b: 1, p: 2 }, showNs: true })?.showNs).toBe(true);
    const bads = [null, 3, {}, { source: { kind: "x" } }, { source: src, levels: "no" }, { source: src, showP: 1 },
      { source: src, levels: [{ mark: "*", below: 7 }] }, { source: { kind: "sheet", datasetId: "d", a: 0.5, b: 1, p: 2 } }];
    for (const bad of bads) expect(normalizeSig(bad)).toBeNull();
  });

  it("survives the sanitizer and resolves lazily; a malformed one resolves to none", () => {
    const saved = sanitizeStatMarks({ summary: "mean", sig: { source: src, showP: true } });
    expect(saved.sig).toBeTruthy();
    expect(resolveStatMarks("box", saved).sig?.showP).toBe(true);
    expect(resolveStatMarks("box", sanitizeStatMarks({ sig: { source: "x" } })).sig).toBeUndefined();
    expect(resolveStatMarks("box", {}).sig).toBeUndefined(); // no source is chosen for the user
    expect(sanitizeStatMarks({ sig: "x" }).sig).toBeUndefined();
  });
});
