import { describe, expect, it } from "vitest";

import { countUnescapedDollars, insertLabelToken, type PaletteEntry } from "./SymbolPalette";

const alpha: PaletteEntry = { glyph: "α", math: "\\alpha", title: "\\alpha" };
const degree: PaletteEntry = { glyph: "°", text: "°", math: "^\\circ", title: "deg" };
const sub: PaletteEntry = { glyph: "x₂", math: "_{}", caretBack: 1, title: "sub" };
const snippet: PaletteEntry = { glyph: "µ₀H", text: "$\\mu_0H$ (T)", title: "field" };

describe("countUnescapedDollars", () => {
  it("counts $ but not \\$", () => {
    expect(countUnescapedDollars("a$b$c")).toBe(2);
    expect(countUnescapedDollars("cost \\$5")).toBe(0);
    expect(countUnescapedDollars("$x$ \\$ $")).toBe(3);
  });
});

describe("insertLabelToken", () => {
  it("wraps a math entry in $...$ when inserting outside math", () => {
    const r = insertLabelToken("Field ", 6, 6, alpha);
    expect(r.value).toBe("Field $\\alpha$");
    expect(r.cursor).toBe(14);
  });

  it("inserts the bare command inside a math region", () => {
    // caret after "$\mu_0" -> inside math
    const src = "$\\mu_0$ (T)";
    const r = insertLabelToken(src, 6, 6, alpha);
    expect(r.value).toBe("$\\mu_0\\alpha$ (T)");
  });

  it("pads a bare command with a space when a letter follows (no \\alphax)", () => {
    const src = "$xy$";
    const r = insertLabelToken(src, 2, 2, alpha);
    expect(r.value).toBe("$x\\alpha y$");
  });

  it("prefers the plain-text form outside math", () => {
    const r = insertLabelToken("20", 2, 2, degree);
    expect(r.value).toBe("20°");
  });

  it("uses the math form (^\\circ) inside math", () => {
    const r = insertLabelToken("$20$", 3, 3, degree);
    expect(r.value).toBe("$20^\\circ$");
  });

  it("places the caret between the braces of a script inserter", () => {
    const r = insertLabelToken("", 0, 0, sub);
    expect(r.value).toBe("$_{}$");
    expect(r.cursor).toBe(3); // between { and }
    const inMath = insertLabelToken("$x$", 2, 2, sub);
    expect(inMath.value).toBe("$x_{}$");
    expect(inMath.cursor).toBe(4);
  });

  it("replaces a selection", () => {
    const r = insertLabelToken("Field X", 6, 7, snippet);
    expect(r.value).toBe("Field $\\mu_0H$ (T)");
  });
});
