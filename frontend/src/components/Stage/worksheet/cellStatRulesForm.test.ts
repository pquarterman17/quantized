// The statistic fields of the Conditional Format form: they read into rules,
// seed from a column's current rule, refuse a number that cannot mean the rule,
// and an old form without them reads exactly as before.

import { describe, expect, it } from "vitest";

import { rulesFromParams, ruleFields } from "./cellRulesDialog";
import { statFields, statFromParams } from "./cellStatRulesForm";

const blank = { op0: "(none)", a0: 0, b0: 0, tone0: "Red", op1: "(none)", a1: 0, b1: 0, tone1: "Amber", scale: "(none)", low: "Series 6", mid: "Amber", high: "Red" };

describe("statFromParams", () => {
  it("reads each choice", () => {
    expect(statFromParams({ stat: "duplicate values", statN: 1, statTone: "Amber" })).toEqual({ rule: { kind: "duplicate", tone: "warn" } });
    expect(statFromParams({ stat: "outliers (beyond Q1/Q3 by k × IQR)", statN: 1.5, statTone: "Red" })).toEqual({ rule: { kind: "outlier", k: 1.5, tone: "danger" } });
    expect(statFromParams({ stat: "top N values", statN: 3.4, statTone: "Green" })).toEqual({ rule: { kind: "rank", end: "top", n: 3, tone: "ok" } });
    expect(statFromParams({ stat: "bottom N percent", statN: 10, statTone: "Green" })).toEqual({ rule: { kind: "rank", end: "bottom", n: 10, percent: true, tone: "ok" } });
  });
  it("(none), or a form that predates these fields, is no rule", () => {
    expect(statFromParams({ stat: "(none)", statN: 1, statTone: "Red" })).toEqual({});
    expect(statFromParams(blank)).toEqual({});
  });
  it("refuses a number that cannot mean the rule", () => {
    expect(statFromParams({ stat: "top N values", statN: 0.3, statTone: "Red" })).toMatchObject({ error: expect.stringContaining("whole number") });
    expect(statFromParams({ stat: "top N percent", statN: 150, statTone: "Red" })).toMatchObject({ error: expect.stringContaining("percentage") });
    expect(statFromParams({ stat: "outliers (beyond Q1/Q3 by k × IQR)", statN: -1, statTone: "Red" })).toMatchObject({ error: expect.stringContaining("k must") });
  });
});

describe("in the shared form", () => {
  it("is appended to the value rules and the scale in list order", () => {
    const out = rulesFromParams({ ...blank, op0: "greater than", a0: 1, stat: "duplicate values", statN: 1, statTone: "Accent", scale: "2-color" });
    expect(out).toEqual({
      rules: [
        { kind: "value", op: ">", a: 1, tone: "danger" },
        { kind: "duplicate", tone: "accent" },
        { kind: "scale", low: "series-6", high: "danger" },
      ],
    });
  });
  it("a refused statistic applies nothing", () => {
    expect(rulesFromParams({ ...blank, stat: "top N values", statN: 0, statTone: "Red" })).toHaveProperty("error");
  });
  it("seeds from the column's current statistic rule", () => {
    const f = Object.fromEntries(ruleFields([{ kind: "rank", end: "bottom", n: 5, percent: true, tone: "ok" }]).map((x) => [x.key, x.default]));
    expect(f).toMatchObject({ stat: "bottom N percent", statN: 5, statTone: "Green" });
    expect(Object.fromEntries(statFields().map((x) => [x.key, x.default]))).toMatchObject({ stat: "(none)", statN: 1.5 });
  });
});
