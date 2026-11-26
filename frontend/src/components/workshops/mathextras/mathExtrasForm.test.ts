import { describe, expect, it } from "vitest";

import { emptyForm, finite, fmt, parseBounds, parseConstants, parseQueries, parseSizing } from "./mathExtrasForm";

describe("mathExtrasForm parsers", () => {
  it("sizes by count or spacing and refuses bad entries", () => {
    expect(parseSizing({ ...emptyForm(), n: "50" })).toEqual({ value: { n: 50 } });
    expect(parseSizing({ ...emptyForm(), sizing: "spacing", spacing: "0.25" })).toEqual({ value: { spacing: 0.25 } });
    expect(parseSizing({ ...emptyForm(), n: "1" }).error).toMatch(/at least 2/);
    expect(parseSizing({ ...emptyForm(), n: "2.5" }).error).toMatch(/whole number/);
    expect(parseSizing({ ...emptyForm(), sizing: "spacing", spacing: "0" }).error).toMatch(/above 0/);
    expect(parseSizing({ ...emptyForm(), sizing: "spacing", spacing: "" }).error).toMatch(/Enter the spacing/);
  });

  it("parses query points with any separator and names the bad line", () => {
    expect(parseQueries("0.5 1\n2, 3;\n\n", 2)).toEqual({ value: [[0.5, 1], [2, 3]] });
    expect(parseQueries("1 2 3", 3)).toEqual({ value: [[1, 2, 3]] });
    expect(parseQueries("1 2\n3", 2).error).toMatch(/Line 2 needs 2 numbers/);
    expect(parseQueries("1 2 3", 2).error).toMatch(/Line 1/);
    expect(parseQueries("1 x", 2).error).toMatch(/Line 1/);
    expect(parseQueries("  \n", 2).error).toMatch(/at least one point/);
  });

  it("parses constants and bounds, refusing duplicates, typos and reversed bounds", () => {
    expect(parseConstants("a = 2, b=-3.5; c = 1e3")).toEqual({ value: { a: 2, b: -3.5, c: 1000 } });
    expect(parseConstants("")).toEqual({ value: {} });
    expect(parseConstants("a = two").error).toMatch(/not name = number/);
    expect(parseConstants("a=1, a=2").error).toMatch(/twice/);
    expect(parseBounds("x = -5 .. 5\na: 0, 1\nb = 2 3")).toEqual({ value: { x: [-5, 5], a: [0, 1], b: [2, 3] } });
    expect(parseBounds("x = 5 .. -5").error).toMatch(/lower bound must be below/);
    expect(parseBounds("x = 1").error).toMatch(/not name = low .. high/);
    expect(parseBounds("").error).toMatch(/Give bounds/);
    expect(parseBounds("x=0..1\nx=1..2").error).toMatch(/twice/);
  });

  it("formats numbers and rejects non-numbers", () => {
    expect(fmt(0.1 + 0.2)).toBe("0.3");
    expect(fmt(Number.NaN)).toBe("—");
    expect(finite("abc", "a value").error).toMatch(/Enter a value/);
    expect(finite(" 4 ", "a value")).toEqual({ value: 4 });
  });
});
