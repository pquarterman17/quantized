import { describe, expect, it } from "vitest";

import {
  hasMarkup,
  parseRichText,
  plainText,
  richLabelAst,
  validateRichText,
  type RichNode,
} from "./richtext";

const text = (t: string, italic = false): RichNode => ({ kind: "text", text: t, italic });

describe("hasMarkup fast path", () => {
  it("is false for plain labels (byte-identical fast path)", () => {
    expect(hasMarkup("Temperature (K)")).toBe(false);
    expect(hasMarkup("Å spacing, 2θ (°)")).toBe(false); // Unicode alone is not markup
  });
  it("is true whenever a dollar appears", () => {
    expect(hasMarkup("$x$")).toBe(true);
    expect(hasMarkup("cost \\$5")).toBe(true);
  });
});

describe("parseRichText — plain and text segments", () => {
  it("parses a $-free label as one literal run", () => {
    expect(parseRichText("Moment (emu)")).toEqual({
      ok: true,
      error: null,
      nodes: [text("Moment (emu)")],
    });
  });

  it("passes text outside math through verbatim, Unicode included", () => {
    const r = parseRichText("χ″ vs T $x$ (°C)");
    expect(r.ok).toBe(true);
    expect(r.nodes[0]).toEqual(text("χ″ vs T "));
    expect(r.nodes[r.nodes.length - 1]).toEqual(text(" (°C)"));
  });

  it("unescapes \\$ to a literal dollar outside math", () => {
    const r = parseRichText("cost \\$5");
    expect(r.ok).toBe(true);
    expect(r.nodes).toEqual([text("cost $5")]);
  });
});

describe("parseRichText — math constructs", () => {
  it("italicizes single letters (mathtext convention)", () => {
    expect(parseRichText("$x$").nodes).toEqual([text("x", true)]);
  });

  it("keeps digits and punctuation upright, letters italic", () => {
    const r = parseRichText("$M=2x$");
    expect(r.nodes).toEqual([text("M", true), text("=2", false), text("x", true)]);
  });

  it("parses the field-axis idiom $\\mu_0H$ (T)", () => {
    const r = parseRichText("$\\mu_0H$ (T)");
    expect(r.ok).toBe(true);
    expect(r.nodes).toEqual([
      text("μ", true),
      { kind: "sub", children: [text("0")] },
      text("H", true),
      text(" (T)"),
    ]);
  });

  it("renders \\AA^{-1} with a true minus in the superscript", () => {
    const r = parseRichText("$\\AA^{-1}$");
    expect(r.nodes).toEqual([text("Å"), { kind: "sup", children: [text("−1")] }]);
  });

  it("supports braced and single-token scripts, nesting included", () => {
    const r = parseRichText("$x_{a_{b}}$");
    expect(r.nodes).toEqual([
      text("x", true),
      {
        kind: "sub",
        children: [text("a", true), { kind: "sub", children: [text("b", true)] }],
      },
    ]);
  });

  it("supports a script with no base (the ^\\circ degree idiom)", () => {
    const r = parseRichText("$^\\circ$");
    expect(r.ok).toBe(true);
    expect(r.nodes).toEqual([{ kind: "sup", children: [text("∘")] }]);
  });

  it("maps Greek commands (lowercase italic, uppercase upright)", () => {
    expect(parseRichText("$\\alpha$").nodes).toEqual([text("α", true)]);
    expect(parseRichText("$\\Omega$").nodes).toEqual([text("Ω", false)]);
    expect(parseRichText("$\\varepsilon$").nodes).toEqual([text("ε", true)]);
  });

  it("styles \\mathrm upright and \\mathit italic", () => {
    expect(parseRichText("$\\mathrm{H}_{c2}$").nodes).toEqual([
      text("H", false),
      { kind: "sub", children: [text("c", true), text("2", false)] },
    ]);
    expect(parseRichText("$\\mathit{abc}$").nodes).toEqual([text("abc", true)]);
  });

  it("drops whitespace inside math (mathtext rule) and keeps \\, as thin space", () => {
    expect(parseRichText("$a b$").nodes).toEqual([text("ab", true)]);
    expect(parseRichText("$a\\,b$").nodes).toEqual([
      text("a", true),
      text(" "), // thin space
      text("b", true),
    ]);
  });

  it("renders primes for ' (the $\\chi''$ palette snippet)", () => {
    expect(parseRichText("$\\chi''$").nodes).toEqual([text("χ", true), text("′′", false)]);
  });

  it("accepts the symbol commands", () => {
    expect(parseRichText("$1\\times2\\cdot3\\pm4$").nodes).toEqual([
      text("1×2⋅3±4", false),
    ]);
  });

  it("accepts relations, arrows, and analysis glyphs (MAIN #28)", () => {
    // Each command maps to the SAME Unicode glyph matplotlib draws (probed),
    // rendering upright and merging into one run.
    expect(parseRichText("$a\\leq b\\geq c\\neq d$").nodes).toEqual([
      text("a", true), text("≤", false), text("b", true), text("≥", false),
      text("c", true), text("≠", false), text("d", true),
    ]);
    expect(plainText(parseRichText("$\\approx\\equiv\\sim\\propto\\ll\\gg$").nodes))
      .toBe("≈≡∼∝≪≫");
    expect(plainText(parseRichText("$\\infty\\partial\\nabla\\perp\\parallel\\angle$").nodes))
      .toBe("∞∂∇⊥∥∠");
    expect(plainText(parseRichText("$\\rightarrow\\to\\leftarrow\\leftrightarrow\\Rightarrow$").nodes))
      .toBe("→→←↔⇒");
    expect(plainText(parseRichText("$\\mp\\div\\cdots\\ldots\\dots$").nodes)).toBe("∓÷⋯……");
  });

  it("accepts verified literal Unicode in math (°, Å, µ, Greek)", () => {
    const r = parseRichText("$µ°Åα$");
    expect(r.ok).toBe(true);
    expect(plainText(r.nodes)).toBe("µ°Åα");
  });

  it("flattens bare {...} groups", () => {
    expect(parseRichText("$10^{n}$").nodes).toEqual([
      text("10", false),
      { kind: "sup", children: [text("n", true)] },
    ]);
  });
});

describe("parseRichText — rejection / literal fallback (never throws)", () => {
  const invalid = [
    ["$x", "unclosed math region"],
    ["$x_{2$", "unclosed group"],
    ["$x}$", "unmatched brace"],
    ["$\\foo$", "unknown command"],
    ["$50%$", "mathtext-invalid % in math"],
    ["$a#b$", "mathtext-invalid # in math"],
    ["$$", "empty math region"],
    ["$x_$", "dangling script"],
    ["C:\\temp $x$", "backslash outside math in a math-bearing string"],
  ] as const;

  it.each(invalid)("%s -> whole-string literal fallback (%s)", (src) => {
    const r = parseRichText(src);
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
    expect(r.nodes).toEqual([text(src)]);
  });

  it("accepts % and # OUTSIDE math regions", () => {
    // matplotlib parses whole math-bearing strings, but its text mode passes
    // %/# through — only math mode rejects them (probed, mpl 3.11).
    expect(parseRichText("50% $x$").ok).toBe(true);
  });
});

describe("richLabelAst (renderer gate)", () => {
  it("is null for plain, invalid, empty, and nullish labels", () => {
    expect(richLabelAst("Temperature (K)")).toBeNull();
    expect(richLabelAst("$\\foo$")).toBeNull();
    expect(richLabelAst("")).toBeNull();
    expect(richLabelAst(undefined)).toBeNull();
    expect(richLabelAst(null)).toBeNull();
  });
  it("returns the AST for a valid rich label", () => {
    expect(richLabelAst("$M_s$")).toEqual([
      text("M", true),
      { kind: "sub", children: [text("s", true)] },
    ]);
  });
});

describe("plainText", () => {
  it("flattens scripts in reading order", () => {
    expect(plainText("$\\mu_0H$ (T)")).toBe("μ0H (T)");
    expect(plainText("$\\AA^{-1}$")).toBe("Å−1");
  });
  it("returns the source for invalid markup (literal fallback)", () => {
    expect(plainText("$\\foo$")).toBe("$\\foo$");
  });
});

describe("validateRichText (editor feedback)", () => {
  it("ok for plain and valid labels", () => {
    expect(validateRichText("plain")).toEqual({ ok: true });
    expect(validateRichText("$\\chi''$ (emu)")).toEqual({ ok: true });
  });
  it("carries an ASCII error for invalid markup", () => {
    const v = validateRichText("$\\foo$");
    expect(v.ok).toBe(false);
    expect(v.error).toMatch(/unknown command/);
  });
});
