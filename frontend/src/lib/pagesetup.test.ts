import { describe, expect, it } from "vitest";

import {
  contentRectFractions,
  defaultPageSetup,
  fromInches,
  pageAspect,
  pageSetupFromDecoded,
  sanitizePageSetup,
  toInches,
  type PageSetup,
} from "./pagesetup";

describe("unit conversions", () => {
  it("round-trips cm/px through inches", () => {
    expect(toInches(2.54, "cm")).toBeCloseTo(1, 10);
    expect(toInches(96, "px")).toBeCloseTo(1, 10);
    expect(toInches(3, "in")).toBe(3);
    expect(fromInches(1, "cm")).toBeCloseTo(2.54, 10);
    expect(fromInches(1, "px")).toBeCloseTo(96, 10);
  });
});

describe("pageAspect", () => {
  it("is width/height, unit-independent, null when degenerate", () => {
    expect(pageAspect({ width: 6, height: 4 })).toBe(1.5);
    expect(pageAspect({ width: 6, height: 0 })).toBeNull();
  });
});

describe("pageSetupFromDecoded (aspect-honest prefill)", () => {
  it("keeps the decoded ASPECT, derives the height, and flags aspectDerived", () => {
    // A wide 1000x400 decoded page (aspect 2.5): the fabricated width is the
    // publication default, the height is derived to match the aspect — the
    // ABSOLUTE size is never claimed as physical (aspectDerived: true).
    const ps = pageSetupFromDecoded({ width: 1000, height: 400 });
    expect(ps).not.toBeNull();
    expect(ps!.aspectDerived).toBe(true);
    expect(ps!.unit).toBe("in");
    expect(ps!.width / ps!.height).toBeCloseTo(2.5, 10);
  });

  it("returns null for an absent or degenerate decoded page", () => {
    expect(pageSetupFromDecoded(null)).toBeNull();
    expect(pageSetupFromDecoded({ width: 0, height: 400 })).toBeNull();
  });
});

describe("contentRectFractions", () => {
  it("insets by the margins as page fractions (subplotpars convention)", () => {
    const ps: PageSetup = {
      width: 10,
      height: 8,
      unit: "in",
      margins: { left: 1, right: 2, top: 1, bottom: 1 },
      aspectDerived: false,
    };
    // left=1/10, right=1-2/10, bottom=1/8, top=1-1/8.
    expect(contentRectFractions(ps)).toEqual({ left: 0.1, right: 0.8, bottom: 0.125, top: 0.875 });
  });

  it("clamps pathological margins so the content rect never inverts", () => {
    const ps: PageSetup = {
      width: 10,
      height: 8,
      unit: "in",
      margins: { left: 100, right: 100, top: 100, bottom: 100 },
      aspectDerived: false,
    };
    const c = contentRectFractions(ps);
    expect(c.left).toBeLessThan(c.right);
    expect(c.bottom).toBeLessThan(c.top);
  });
});

describe("sanitizePageSetup", () => {
  it("returns null for a non-object", () => {
    expect(sanitizePageSetup(null)).toBeNull();
    expect(sanitizePageSetup(42)).toBeNull();
  });

  it("clamps dims positive, margins non-negative, and defaults a bad unit", () => {
    const ps = sanitizePageSetup({
      width: -3,
      height: "x",
      unit: "furlong",
      margins: { left: -1, right: 0.5 },
      aspectDerived: true,
    });
    expect(ps).not.toBeNull();
    expect(ps!.width).toBeGreaterThan(0);
    expect(ps!.height).toBeGreaterThan(0);
    expect(ps!.unit).toBe("in");
    expect(ps!.margins.left).toBe(0);
    expect(ps!.margins.right).toBe(0.5);
    expect(ps!.margins.top).toBe(0);
    expect(ps!.aspectDerived).toBe(true);
  });

  it("round-trips a valid page unchanged", () => {
    const ps = defaultPageSetup();
    expect(sanitizePageSetup(ps)).toEqual(ps);
  });
});
