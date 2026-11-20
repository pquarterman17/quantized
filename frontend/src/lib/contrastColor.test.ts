import { describe, expect, it } from "vitest";

import { parseColor, resolveDrawColor } from "./contrastColor";

function ratio(hex: string, bgL: number): number {
  const lin = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = parseColor(hex)!;
  const l = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return (Math.max(l, bgL) + 0.05) / (Math.min(l, bgL) + 0.05);
}
function hue(hex: string): number {
  const [r, g, b] = parseColor(hex)!;
  const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

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

  it("lightens a near-black coloured (chromatic) stroke keeping its hue, not the ink token (A4)", () => {
    const out = resolveDrawColor("#140000", true, "#eef0f6"); // very dark red
    expect(out).not.toBe("#eef0f6");
    expect(hue(out)).toBeLessThan(3);
  });
});

describe("resolveDrawColor keeps the hue of a chromatic colour (A4)", () => {
  it("darkens a pale saturated colour on the light canvas instead of swapping to ink", () => {
    for (const c of ["#00FF00", "#FFFF80"]) {
      const out = resolveDrawColor(c, false, "#111111");
      expect(out).not.toBe("#111111");
      expect(ratio(out, 0.94)).toBeGreaterThanOrEqual(2.2);
      expect(Math.abs(hue(out) - hue(c))).toBeLessThan(3);
    }
  });
  it("lightens a dark chromatic colour on the dark canvas, hue kept", () => {
    const out = resolveDrawColor("#000080", true, "#eeeeee");
    expect(out).not.toBe("#eeeeee");
    expect(ratio(out, 0.006)).toBeGreaterThanOrEqual(2.2);
    expect(Math.abs(hue(out) - hue("#000080"))).toBeLessThan(3);
  });
  it("two distinct pale colours stay distinct", () => {
    const pairs: [string, string][] = [["#FFFF80", "#80FFFF"], ["#FFFF80", "#FFFFC0"]];
    for (const [a, b] of pairs) {
      expect(resolveDrawColor(a, false, "#111")).not.toBe(resolveDrawColor(b, false, "#111"));
    }
  });
  it("achromatic black on the dark canvas still becomes the ink token", () => {
    expect(resolveDrawColor("#000000", true, "#eef0f6")).toBe("#eef0f6");
    expect(resolveDrawColor("#fafafa", false, "#1e1e26")).toBe("#1e1e26");
  });
  it("a colour that already contrasts is untouched", () => {
    expect(resolveDrawColor("#00FF00", true)).toBe("#00FF00");
  });
});
