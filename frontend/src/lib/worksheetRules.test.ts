// Worksheet conditional formatting (gap audit 8, lane CFMT): the rule model's
// sanitizer fails closed, value rules and 2- / 3-colour scales colour cells
// from design tokens only, and compiling touches a column once, not per cell.

import { describe, expect, it } from "vitest";

import { remapDatasetChannels } from "./channelRemap";
import { cellBackground, compileCellRules, matchesValueRule, scaleColour } from "./worksheetRules";
import { sanitizeCellRules, sanitizeRule, sanitizeRuleList, RULE_TONES, type CellRule, type ValueRule } from "./worksheetRulesModel";

const gt = (a: number): ValueRule => ({ kind: "value", op: ">", a, tone: "danger" });

describe("value rules", () => {
  it("> and < are strict, between is inclusive, NaN matches NaN and missing only", () => {
    expect(matchesValueRule(gt(5), 5)).toBe(false);
    expect(matchesValueRule(gt(5), 5.1)).toBe(true);
    expect(matchesValueRule({ kind: "value", op: "<", a: 5, tone: "ok" }, 4.9)).toBe(true);
    const between: ValueRule = { kind: "value", op: "between", a: 1, b: 2, tone: "warn" };
    expect([0.9, 1, 1.5, 2, 2.1].map((v) => matchesValueRule(between, v))).toEqual([false, true, true, true, false]);
    const nan: ValueRule = { kind: "value", op: "nan", tone: "accent" };
    expect(matchesValueRule(nan, NaN)).toBe(true);
    expect(matchesValueRule(nan, undefined)).toBe(true);
    expect(matchesValueRule(nan, 0)).toBe(false);
    expect(matchesValueRule(nan, Infinity)).toBe(false);
    expect(matchesValueRule(gt(0), NaN)).toBe(false); // NaN never satisfies a comparison
  });

  it("the first matching rule wins and colours are tokens softened into the surface", () => {
    const rules: CellRule[] = [{ kind: "value", op: ">", a: 10, tone: "danger" }, { kind: "value", op: ">", a: 1, tone: "warn" }];
    expect(cellBackground(rules, 20, null)).toBe("color-mix(in srgb, var(--danger) 30%, var(--surface-0))");
    expect(cellBackground(rules, 5, null)).toBe("color-mix(in srgb, var(--warn) 30%, var(--surface-0))");
    expect(cellBackground(rules, 0, null)).toBeUndefined();
  });
});

describe("colour scales", () => {
  const two: CellRule = { kind: "scale", low: "series-6", high: "danger" };
  const three: CellRule = { kind: "scale", low: "ok", mid: "warn", high: "danger" };

  it("2-colour: the ends are the tokens, the middle is an even blend", () => {
    const r = { min: 0, max: 10 };
    expect(cellBackground([two], 0, r)).toContain("var(--danger) 0%, var(--series-6)");
    expect(cellBackground([two], 10, r)).toContain("var(--danger) 100%, var(--series-6)");
    expect(cellBackground([two], 5, r)).toContain("var(--danger) 50%, var(--series-6)");
  });

  it("3-colour: low to mid below the middle, mid to high above it", () => {
    const r = { min: 0, max: 10 };
    expect(cellBackground([three], 0, r)).toContain("var(--warn) 0%, var(--ok)");
    expect(cellBackground([three], 2.5, r)).toContain("var(--warn) 50%, var(--ok)");
    expect(cellBackground([three], 5, r)).toContain("var(--danger) 0%, var(--warn)");
    expect(cellBackground([three], 10, r)).toContain("var(--danger) 100%, var(--warn)");
  });

  it("clamps outside the range; a value rule beats the scale", () => {
    expect(scaleColour(two as never, 7)).toContain("100%");
    expect(scaleColour(two as never, -3)).toContain(" 0%");
    expect(cellBackground([gt(8), two], 9, { min: 0, max: 10 })).toBe("color-mix(in srgb, var(--danger) 30%, var(--surface-0))");
  });

  it("refuses to colour what has no scale: NaN, infinity, a flat column", () => {
    expect(cellBackground([two], NaN, { min: 0, max: 10 })).toBeUndefined();
    expect(cellBackground([two], Infinity, { min: 0, max: 10 })).toBeUndefined();
    expect(cellBackground([two], 4, { min: 4, max: 4 })).toBeUndefined();
    expect(cellBackground([two], 4, null)).toBeUndefined();
  });

  it("every colour in every rule is a design token (no raw colour can appear)", () => {
    for (const t of RULE_TONES) {
      const css = cellBackground([{ kind: "value", op: "nan", tone: t }], NaN, null)!;
      expect(css.replace(/var\(--[a-z0-9-]+\)/g, "").replace("color-mix(in srgb,", "")).not.toMatch(/#|rgb|hsl|oklch|[a-z]/);
      expect(css).toContain(`var(--${t})`);
    }
  });
});

describe("compileCellRules", () => {
  const values = [[1, 100], [2, NaN], [3, 300]];

  it("scale range is the column's finite min..max; unruled columns give nothing", () => {
    const tint = compileCellRules({ 1: [{ kind: "scale", low: "ok", high: "danger" }] }, values)!;
    expect(tint(1, 100)).toContain("var(--danger) 0%");
    expect(tint(1, 300)).toContain("var(--danger) 100%");
    expect(tint(1, NaN)).toBeUndefined();
    expect(tint(0, 2)).toBeUndefined();
  });

  it("is absent with no rules, and scans a column only when it has a scale", () => {
    expect(compileCellRules(undefined, values)).toBeUndefined();
    const probe = { get length() { throw new Error("scanned"); } } as unknown as number[][];
    expect(() => compileCellRules({ 0: [gt(1)] }, probe)).not.toThrow();
  });
});

describe("sanitizer fails closed", () => {
  it("drops unknown kinds, raw colours, bad thresholds and reversed bounds", () => {
    expect(sanitizeRule({ kind: "value", op: ">", a: 1, tone: "#ff0000" })).toBeNull();
    expect(sanitizeRule({ kind: "value", op: ">", a: 1, tone: "url(x)" })).toBeNull();
    expect(sanitizeRule({ kind: "value", op: ">", a: NaN, tone: "ok" })).toBeNull();
    expect(sanitizeRule({ kind: "value", op: ">", tone: "ok" })).toBeNull();
    expect(sanitizeRule({ kind: "value", op: "between", a: 5, b: 1, tone: "ok" })).toBeNull();
    expect(sanitizeRule({ kind: "value", op: "~=", a: 1, tone: "ok" })).toBeNull();
    expect(sanitizeRule({ kind: "scale", low: "ok", mid: "nope", high: "danger" })).toBeNull();
    expect(sanitizeRule({ kind: "future", tone: "ok" })).toBeNull();
    expect(sanitizeRule("x")).toBeNull();
  });

  it("keeps valid rules, one scale per column, and at most eight", () => {
    const s = { kind: "scale", low: "ok", high: "danger" };
    expect(sanitizeRuleList([s, s, gt(1)])).toEqual([s, gt(1)]);
    expect(sanitizeRuleList(Array.from({ length: 20 }, () => gt(1)))).toHaveLength(8);
    expect(sanitizeRuleList([{ junk: 1 }])).toBeUndefined();
    expect(sanitizeRuleList("no")).toBeUndefined();
  });

  it("keeps in-range integer columns only", () => {
    const out = sanitizeCellRules({ 0: [gt(1)], 2: [gt(1)], 9: [gt(1)], "-1": [gt(1)], x: [gt(1)], 1: [{ bad: 1 }] }, 3);
    expect(Object.keys(out!)).toEqual(["0", "2"]);
    expect(sanitizeCellRules({ 9: [gt(1)] }, 3)).toBeUndefined();
    expect(sanitizeCellRules([gt(1)], 3)).toBeUndefined();
  });
});

describe("rules follow their column", () => {
  const rules = { 1: [gt(1)], 3: [gt(3)] };
  it("insert shifts, delete drops and shifts", () => {
    expect(Object.keys(remapDatasetChannels({ cellRules: rules }, { inserted: 0 }).cellRules!)).toEqual(["2", "4"]);
    expect(Object.keys(remapDatasetChannels({ cellRules: rules }, 1).cellRules!)).toEqual(["2"]);
    expect(remapDatasetChannels({ cellRules: { 1: [gt(1)] } }, 1).cellRules).toBeUndefined();
  });
  it("a column move carries its rules with it", () => {
    expect(Object.keys(remapDatasetChannels({ cellRules: { 1: [gt(1)] } }, { from: 1, to: 4 }).cellRules!)).toEqual(["4"]);
  });
});
