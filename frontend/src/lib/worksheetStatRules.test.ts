// Statistic conditional-format rules: duplicates, outliers (Tukey fences) and
// top / bottom N or N%. Each kind's matching including NaN, missing and
// infinite cells, the sanitizer, persistence through a save and load, and an
// old project (value rules and a scale only) opening unchanged.

import { describe, expect, it } from "vitest";

import { cellBackground, compileCellRules } from "./worksheetRules";
import { sanitizeCellRules, sanitizeRule, type CellRule, type StatRule } from "./worksheetRulesModel";
import { iqrFences, quantile, rankCount, statMatcher } from "./worksheetStatRules";

const dup: StatRule = { kind: "duplicate", tone: "warn" };
const out = (k = 1.5): StatRule => ({ kind: "outlier", k, tone: "danger" });
const rank = (end: "top" | "bottom", n: number, percent = false): StatRule => ({ kind: "rank", end, n, ...(percent ? { percent } : {}), tone: "ok" });
const hits = (rule: StatRule, col: (number | undefined)[]) => {
  const m = statMatcher(rule, col.filter((v): v is number => v !== undefined && Number.isFinite(v)));
  return col.map((v) => m(v));
};

describe("duplicates", () => {
  it("marks every cell whose value occurs twice or more, and no unique one", () => {
    expect(hits(dup, [1, 2, 1, 3, 2, 2])).toEqual([true, true, true, false, true, true]);
  });
  it("never marks NaN, missing or infinite cells, even when they repeat", () => {
    expect(hits(dup, [NaN, NaN, undefined, undefined, Infinity, Infinity, 5, 5])).toEqual([false, false, false, false, false, false, true, true]);
  });
  it("is exact equality: 0.1 + 0.2 is not 0.3", () => {
    expect(hits(dup, [0.1 + 0.2, 0.3])).toEqual([false, false]);
  });
});

describe("outliers", () => {
  const col = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100];
  it("computes quartiles by linear interpolation (numpy default)", () => {
    expect(quantile([1, 2, 3, 4], 0.25)).toBe(1.75);
    expect(quantile([1, 2, 3, 4], 0.75)).toBe(3.25);
    expect(iqrFences([1, 2, 3, 4, 5, 6, 7, 8], 1.5)).toEqual({ lo: 2.75 - 1.5 * 3.5, hi: 6.25 + 1.5 * 3.5 });
  });
  it("marks values beyond Q1 - k*IQR and Q3 + k*IQR, on both sides", () => {
    expect(hits(out(), col)).toEqual([false, false, false, false, false, false, false, false, false, true]);
    expect(hits(out(), [-50, ...col.slice(0, 9)])[0]).toBe(true);
  });
  it("a larger k is a wider fence", () => {
    expect(hits(out(1.5), [1, 2, 3, 4, 5, 6, 7, 8, 9, 20])[9]).toBe(true);
    expect(hits(out(10), [1, 2, 3, 4, 5, 6, 7, 8, 9, 20])[9]).toBe(false);
  });
  it("needs four finite values; NaN and missing are neither counted nor marked", () => {
    expect(hits(out(), [1, 2, 1000])).toEqual([false, false, false]);
    expect(hits(out(), [...col, NaN, undefined]).slice(-2)).toEqual([false, false]);
    expect(hits(out(), [NaN, 1, 2, 3, 4, 5, 6, 7, 8, 9, 100])[10]).toBe(true);
  });
});

describe("top / bottom N and N%", () => {
  const col = [5, 1, 4, 2, 3, NaN, undefined];
  it("top and bottom N pick that many values", () => {
    expect(hits(rank("top", 2), col)).toEqual([true, false, true, false, false, false, false]);
    expect(hits(rank("bottom", 2), col)).toEqual([false, true, false, true, false, false, false]);
  });
  it("ties at the cut are all included", () => {
    expect(hits(rank("top", 1), [3, 9, 9, 1])).toEqual([false, true, true, false]);
  });
  it("N larger than the column marks every finite value, never a missing one", () => {
    expect(hits(rank("top", 50), col)).toEqual([true, true, true, true, true, false, false]);
  });
  it("percent is of the finite count, floored, at least one value", () => {
    const ten = Array.from({ length: 10 }, (_, i) => i);
    expect(hits(rank("top", 30, true), ten).filter(Boolean)).toHaveLength(3);
    expect(hits(rank("bottom", 1, true), ten).filter(Boolean)).toHaveLength(1);
    expect(rankCount({ kind: "rank", end: "top", n: 25, percent: true, tone: "ok" }, 10)).toBe(2);
  });
  it("an all-missing column matches nothing", () => {
    expect(hits(rank("top", 3), [NaN, undefined])).toEqual([false, false]);
  });
});

describe("through the grid's lookup", () => {
  const values = [[1, 7], [2, 7], [3, 8], [NaN, 100]];
  it("colours matching cells with a token, leaves the rest, and honours list order", () => {
    const tint = compileCellRules({ 1: [dup] }, values)!;
    expect(tint(1, 7)).toBe("color-mix(in srgb, var(--warn) 30%, var(--surface-0))");
    expect(tint(1, 8)).toBeUndefined();
    expect(tint(1, NaN)).toBeUndefined();
    expect(tint(1, undefined)).toBeUndefined();
    const first: CellRule[] = [{ kind: "value", op: ">", a: 50, tone: "danger" }, rank("top", 1)];
    expect(cellBackground(first, 100, null, [undefined, () => true])).toContain("var(--danger)");
  });
  it("a statistic rule beats the scale; the scale still colours the rest", () => {
    const tint = compileCellRules({ 1: [rank("top", 1), { kind: "scale", low: "ok", high: "danger" }] }, values)!;
    expect(tint(1, 100)).toContain("var(--ok) 30%");
    expect(tint(1, 8)).toContain("var(--danger)");
  });
  it("statistics are over the column's own values only", () => {
    const tint = compileCellRules({ 0: [rank("bottom", 1)] }, values)!;
    expect(tint(0, 1)).toBeDefined();
    expect(tint(0, 2)).toBeUndefined();
    expect(tint(1, 7)).toBeUndefined();
  });
});

describe("sanitizer and persistence", () => {
  it("keeps valid statistic rules and drops malformed ones", () => {
    expect(sanitizeRule(dup)).toEqual(dup);
    expect(sanitizeRule(out(2))).toEqual(out(2));
    expect(sanitizeRule(rank("top", 2.6))).toEqual(rank("top", 3));
    expect(sanitizeRule(rank("bottom", 12.5, true))).toEqual(rank("bottom", 12.5, true));
    for (const bad of [
      { kind: "duplicate", tone: "#f00" },
      { kind: "outlier", k: 0, tone: "ok" },
      { kind: "outlier", k: NaN, tone: "ok" },
      { kind: "outlier", k: 1000, tone: "ok" },
      { kind: "rank", end: "middle", n: 3, tone: "ok" },
      { kind: "rank", end: "top", n: 0.2, tone: "ok" },
      { kind: "rank", end: "top", n: 101, percent: true, tone: "ok" },
      { kind: "rank", end: "top", n: -1, tone: "ok" },
    ]) expect(sanitizeRule(bad), JSON.stringify(bad)).toBeNull();
  });

  it("round-trips through JSON (a .dwk save and load) unchanged", () => {
    const rules = { 0: [dup, out(), rank("top", 5), rank("bottom", 10, true), { kind: "scale", low: "ok", high: "danger" } as CellRule] };
    const loaded = sanitizeCellRules(JSON.parse(JSON.stringify(rules)), 2);
    expect(loaded).toEqual(rules);
  });

  it("an old project (value rules and a scale only) loads exactly as before", () => {
    const old = JSON.parse(
      '{"0":[{"kind":"value","op":">","a":5,"tone":"danger"},{"kind":"value","op":"between","a":1,"b":2,"tone":"ok"},{"kind":"scale","low":"ok","mid":"warn","high":"danger"}],"1":[{"kind":"value","op":"nan","tone":"accent"}]}',
    );
    expect(sanitizeCellRules(old, 2)).toEqual(old);
  });

  it("a file from a build with a still newer kind keeps what this build understands", () => {
    const list = sanitizeCellRules({ 0: [{ kind: "future", tone: "ok" }, dup] }, 1);
    expect(list).toEqual({ 0: [dup] });
  });

  it("statistic rules count toward the per-column cap and are not a second scale", () => {
    const many = sanitizeCellRules({ 0: Array.from({ length: 20 }, () => dup) }, 1);
    expect(many![0]).toHaveLength(8);
  });
});
