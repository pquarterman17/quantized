import { describe, expect, it } from "vitest";

import { parseColor, resolveDrawColor } from "./contrastColor";

describe("parseColor", () => {
  it("parses 3/4/6/8-digit hex", () => {
    expect(parseColor("#000")).toEqual([0, 0, 0]);
    expect(parseColor("#000f")).toEqual([0, 0, 0]);
    expect(parseColor("#ffffff")).toEqual([255, 255, 255]);
    expect(parseColor("#ffffffff")).toEqual([255, 255, 255]);
    expect(parseColor("#FF0000")).toEqual([255, 0, 0]);
  });

  it("parses rgb()/rgba() with comma and space syntax, ints and percentages", () => {
    expect(parseColor("rgb(0,0,0)")).toEqual([0, 0, 0]);
    expect(parseColor("rgb(255, 255, 255)")).toEqual([255, 255, 255]);
    expect(parseColor("rgba(128, 0, 0, 0.5)")).toEqual([128, 0, 0]);
    expect(parseColor("rgb(100% 0% 0%)")).toEqual([255, 0, 0]);
    expect(parseColor("rgb(0 0 0 / 0.4)")).toEqual([0, 0, 0]);
  });

  it("parses hsl()/hsla()", () => {
    expect(parseColor("hsl(0, 0%, 0%)")).toEqual([0, 0, 0]);
    expect(parseColor("hsl(0, 0%, 100%)")).toEqual([255, 255, 255]);
    expect(parseColor("hsla(0, 100%, 50%, 1)")).toEqual([255, 0, 0]);
  });

  it("parses common CSS named colours case-insensitively", () => {
    expect(parseColor("black")).toEqual([0, 0, 0]);
    expect(parseColor("WHITE")).toEqual([255, 255, 255]);
    expect(parseColor("Red")).toEqual([255, 0, 0]);
  });

  it("returns null for unparseable input (oklch tokens, garbage, empty)", () => {
    expect(parseColor("oklch(0.7 0.17 295)")).toBeNull();
    expect(parseColor("not-a-color")).toBeNull();
    expect(parseColor("")).toBeNull();
    expect(parseColor("   ")).toBeNull();
  });
});

describe("resolveDrawColor", () => {
  it("substitutes literal black for the ink token on a dark background", () => {
    expect(resolveDrawColor("black", true, "#fff")).toBe("#fff");
    expect(resolveDrawColor("#000000", true, "#fff")).toBe("#fff");
    expect(resolveDrawColor("rgb(0,0,0)", true, "#fff")).toBe("#fff");
  });

  it("substitutes literal white for the ink token on a light background", () => {
    expect(resolveDrawColor("white", false, "#000")).toBe("#000");
    expect(resolveDrawColor("#ffffff", false, "#000")).toBe("#000");
  });

  it("keeps true black on a LIGHT background (light mode must keep true black)", () => {
    expect(resolveDrawColor("black", false, "#000")).toBe("black");
    expect(resolveDrawColor("#000000", false)).toBe("#000000");
  });

  it("keeps true white on a DARK background", () => {
    expect(resolveDrawColor("white", true, "#fff")).toBe("white");
    expect(resolveDrawColor("#ffffff", true)).toBe("#ffffff");
  });

  it("passes mid-greys through unchanged on both backgrounds", () => {
    expect(resolveDrawColor("#808080", true, "#fff")).toBe("#808080");
    expect(resolveDrawColor("#808080", false, "#000")).toBe("#808080");
    expect(resolveDrawColor("gray", true)).toBe("gray");
    expect(resolveDrawColor("gray", false)).toBe("gray");
  });

  it("passes saturated colours through unchanged (never a hue shift for visible colours)", () => {
    expect(resolveDrawColor("#8b5cf6", true, "#fff")).toBe("#8b5cf6"); // violet, visible on dark
    expect(resolveDrawColor("red", false, "#000")).toBe("red"); // visible on light
  });

  it("accepts hex/rgb/named input forms identically", () => {
    const ink = "#eef0f6";
    expect(resolveDrawColor("black", true, ink)).toBe(ink);
    expect(resolveDrawColor("#000", true, ink)).toBe(ink);
    expect(resolveDrawColor("rgb(0,0,0)", true, ink)).toBe(ink);
    expect(resolveDrawColor("rgba(0,0,0,1)", true, ink)).toBe(ink);
    expect(resolveDrawColor("hsl(0,0%,0%)", true, ink)).toBe(ink);
  });

  it("passes invalid/unparseable input straight through, regardless of background", () => {
    expect(resolveDrawColor("oklch(0.13 0.006 280)", true, "#fff")).toBe("oklch(0.13 0.006 280)");
    expect(resolveDrawColor("not-a-color", false, "#000")).toBe("not-a-color");
    expect(resolveDrawColor("", true)).toBe("");
  });

  it("falls back to a built-in achromatic ink when no inkColor is supplied", () => {
    const dark = resolveDrawColor("black", true);
    const light = resolveDrawColor("white", false);
    expect(dark).not.toBe("black");
    expect(light).not.toBe("white");
    // Fallbacks are themselves achromatic hex, not a hue shift.
    expect(parseColor(dark)).not.toBeNull();
    expect(parseColor(light)).not.toBeNull();
  });

  it("substitutes a near-black colored (non-achromatic) stroke to the achromatic ink token, not a lightened hue", () => {
    const out = resolveDrawColor("#140000", true, "#eef0f6"); // very dark red
    expect(out).toBe("#eef0f6");
  });
});
