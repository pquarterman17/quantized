import { describe, expect, it } from "vitest";

import { validateRichText } from "../../lib/richtext";
import {
  countUnescapedDollars,
  insertLabelToken,
  ITALIC_ENTRY,
  SUBSCRIPT_ENTRY,
  SUPERSCRIPT_ENTRY,
  wrapLabelSelection,
  type PaletteEntry,
} from "./SymbolPalette";

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

// MAIN #17 — keyboard-shortcut wrap-selection mechanics.
describe("wrapLabelSelection", () => {
  it("wraps a selection in italic outside math: $\\mathit{sel}$", () => {
    const src = "Field slope";
    const start = src.indexOf("slope");
    const r = wrapLabelSelection(src, start, start + "slope".length, ITALIC_ENTRY);
    expect(r.value).toBe("Field $\\mathit{slope}$");
    expect(r.cursor).toBe(r.value.length); // lands after the closing $
    expect(validateRichText(r.value)).toEqual({ ok: true });
  });

  it("wraps a selection in subscript outside math: $_{sel}$", () => {
    const src = "Msat";
    const r = wrapLabelSelection(src, 1, 4, SUBSCRIPT_ENTRY);
    expect(r.value).toBe("M$_{sat}$");
    expect(validateRichText(r.value)).toEqual({ ok: true });
  });

  it("wraps a selection in superscript outside math: $^{sel}$", () => {
    const src = "10n";
    const r = wrapLabelSelection(src, 2, 3, SUPERSCRIPT_ENTRY);
    expect(r.value).toBe("10$^{n}$");
    expect(validateRichText(r.value)).toEqual({ ok: true });
  });

  it("wraps bare (no extra $) when the selection is already inside math", () => {
    const src = "$x2$"; // caret selects "2" inside an existing math region
    const r = wrapLabelSelection(src, 2, 3, SUBSCRIPT_ENTRY);
    expect(r.value).toBe("$x_{2}$");
    expect(validateRichText(r.value)).toEqual({ ok: true });
  });

  it("empty selection delegates to insertLabelToken (caret between braces)", () => {
    const wrapped = wrapLabelSelection("Field ", 6, 6, ITALIC_ENTRY);
    const inserted = insertLabelToken("Field ", 6, 6, ITALIC_ENTRY);
    expect(wrapped).toEqual(inserted);
    expect(validateRichText(wrapped.value)).toEqual({ ok: true });
  });

  it("a selection straddling a $...$ boundary never emits invalid markup", () => {
    // Selecting "c$x" spans out of plain text and into an existing math
    // region -- wrapping the raw span would fragment \mathit{...} across
    // the boundary, so this must fall back to a safe (parseable) result
    // instead of the naive "$\mathit{c$x}$".
    const src = "abc$x^2$def";
    const start = src.indexOf("c$x");
    const r = wrapLabelSelection(src, start, start + 3, ITALIC_ENTRY);
    expect(r.value).not.toContain("mathit{c$x}");
    expect(validateRichText(r.value)).toEqual({ ok: true });
  });

  it("never produces the invalid nested-$ shape when the whole existing region is selected", () => {
    // Regression pin: blindly wrapping a selection that ENCLOSES a whole
    // $...$ pair (selecting "$x^2$" including both dollar signs) in another
    // $...$/\mathit{} would sandwich the inner region inside the outer
    // command and fragment across the parser's segment boundaries
    // ("$\mathit{$x^2$}$" -> "unclosed { group in math mode"). Falls back
    // to the safe empty-token insert instead.
    const src = "$x^2$";
    const r = wrapLabelSelection(src, 0, 5, ITALIC_ENTRY); // selects "$x^2$" incl. delimiters
    expect(validateRichText(r.value)).toEqual({ ok: true });
  });
});
