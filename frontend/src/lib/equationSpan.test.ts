// Code-point -> UTF-16 conversion of a validate-route error span (P2.7).

import { describe, expect, it } from "vitest";

import { codePointSpanToUtf16 } from "./equationSpan";

// U+1F600: ONE code point (what Python counts) but TWO UTF-16 units.
const ASTRAL = String.fromCodePoint(0x1f600);

describe("codePointSpanToUtf16", () => {
  it("is the identity for BMP-only text", () => {
    expect(codePointSpanToUtf16("a*foo(x)", 2, 5)).toEqual({ start: 2, end: 5 });
  });

  it("shifts past an astral character before the span", () => {
    const text = `${ASTRAL}+a;b`;
    const span = codePointSpanToUtf16(text, 3, 4);
    expect(span).toEqual({ start: 4, end: 5 });
    expect(text.slice(span!.start, span!.end)).toBe(";");
  });

  it("covers a whole astral character inside the span", () => {
    const text = `a*${ASTRAL}`;
    const span = codePointSpanToUtf16(text, 2, 3);
    expect(text.slice(span!.start, span!.end)).toBe(ASTRAL);
  });

  it("clamps to the text and widens to one character", () => {
    expect(codePointSpanToUtf16("a+", 1, 99)).toEqual({ start: 1, end: 2 });
    expect(codePointSpanToUtf16("a+", 7, 9)).toEqual({ start: 1, end: 2 });
    expect(codePointSpanToUtf16("ab", 1, 1)).toEqual({ start: 1, end: 2 });
  });

  it("is null when there is nothing usable", () => {
    expect(codePointSpanToUtf16("abc", undefined, undefined)).toBeNull();
    expect(codePointSpanToUtf16("", 0, 1)).toBeNull();
    expect(codePointSpanToUtf16("abc", 2, 1)).toBeNull();
    expect(codePointSpanToUtf16("abc", -1, 1)).toBeNull();
  });
});
