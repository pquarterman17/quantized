// Origin escapes (\+( \-( \g( \b( \i() render on screen exactly as in export
// (publication-figures audit #17). The SCREEN half: `originEscapesToMarkup`
// rewrites each case, the canvas parser accepts the result, and the pairs are
// pinned in `tests/fixtures/wire/origin_escapes.json`, which the export half
// (`tests/test_figure_origin_escapes.py`) reads — so the two rewrites cannot
// drift. Regenerate only after a DELIBERATE contract change:
//   ORIGIN_ESCAPES_FIXTURE_WRITE=1 npx vitest run src/lib/originEscapes.test.ts

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import { hasOriginEscape, originEscapesToMarkup } from "./originEscapes";
import { hasMarkup, parseRichText } from "./richtext";
import { plainText } from "./richtextPlain";

/** The module under test starts a lazy import at load; once that chunk has
 *  evaluated and one macrotask has passed, its `.then` has installed it. */
const lazyChunkLoaded = async () => {
  await import("./originEscapes");
  await new Promise((r) => setTimeout(r, 0));
};
beforeAll(lazyChunkLoaded); // the lazy chunk the module under test loads at import

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "tests", "fixtures", "wire", "origin_escapes.json",
);

const INPUTS = [
  "T\\+(2)",
  "M\\-(s) (emu)",
  "2\\g(q) (deg)",
  "\\b(Bold text)",
  "\\i(x) and \\b(\\g(m)\\+(2))",
  "10\\+(-3) emu cm\\+(-3)",
  "\\+(a(b)c)",
  "\\g(Dr)/r",
  "H\\-(c\\-(2))",
  "\\x(1) unknown control",
  "\\+(50%) unsafe body",
  "\\+(unterminated",
  "$x^2$ and \\+(3)",
  "odd $ count \\+(3)",
  "plain label",
  // Review finding: never half-converted, and never math in one half only.
  "\\g(\\+(2)) nested literal",
  "\\b(\\g(\\+(a))) nested literal",
  "\\\\+(2) escaped backslash",
  "\\+(é) outside the math subset",
  "\\+(@) outside the math subset",
  "\\+(!?) outside the math subset",
  '\\+("x") outside the math subset',
  "\\+([1]) inside it",
  "\\+(°C) inside it",
];

const fresh = () => INPUTS.map((input) => [input, originEscapesToMarkup(input)]);

describe("Origin rich-text escapes (screen half)", () => {
  it("rewrites sup / sub / Greek / bold / italic into the mathtext subset", () => {
    expect(originEscapesToMarkup("T\\+(2)")).toBe("T$^{\\mathrm{2}}$");
    expect(originEscapesToMarkup("M\\-(s)")).toBe("M$_{\\mathrm{s}}$");
    expect(originEscapesToMarkup("2\\g(q)")).toBe("2θ");
    expect(originEscapesToMarkup("\\b(Bold text)")).toBe("$\\mathbf{Bold\\ text}$");
    expect(originEscapesToMarkup("\\i(x)")).toBe("$\\mathit{x}$");
  });

  it("leaves unknown, unsafe and unterminated runs exactly as typed", () => {
    for (const s of ["\\x(1)", "\\+(50%)", "\\+(open", "odd $ \\+(3)"]) {
      expect(originEscapesToMarkup(s)).toBe(s);
    }
  });

  it("every converted label parses and renders styled runs on the canvas", () => {
    for (const [input, out] of fresh()) {
      if (out === input) continue;
      expect(hasMarkup(input), input).toBe(true);
      expect(parseRichText(input).ok, input).toBe(true);
    }
    const sup = parseRichText("T\\+(2)").nodes;
    expect(sup).toEqual([{ kind: "text", text: "T", italic: false }, { kind: "sup", children: [{ kind: "text", text: "2", italic: false }] }]);
    const bold = parseRichText("\\b(Bold text)").nodes;
    expect(bold).toEqual([{ kind: "text", text: "Bold text", italic: false, bold: true }]);
    expect(plainText("2\\g(q) (deg)")).toBe("2θ (deg)");
  });

  it("the eager detector agrees with the lazy rewrite's own", () => {
    for (const input of INPUTS) expect(hasMarkup(input) || !hasOriginEscape(input), input).toBe(true);
    expect(hasMarkup("C:\\path (x)")).toBe(false);
  });

  it("detects escapes without false positives", () => {
    expect(hasOriginEscape("a\\+(b)")).toBe(true);
    expect(hasOriginEscape("C:\\path (x)")).toBe(false);
  });

  it("a run the screen cannot draw as math stays exactly as typed, whole (review finding)", () => {
    for (const s of ["\\g(\\+(2))", "\\b(\\g(\\+(a)))", "\\\\+(2)", "\\+(é)", "\\+(@)", "\\+(!?)", '\\+("x")']) {
      expect(originEscapesToMarkup(s), s).toBe(s);
    }
    expect(hasOriginEscape("\\\\+(2)")).toBe(false);
  });

  it("matches the committed fixture the export half reads", () => {
    const now = { cases: fresh() };
    if (process.env.ORIGIN_ESCAPES_FIXTURE_WRITE) {
      writeFileSync(FIXTURE, `${JSON.stringify(now, null, 2)}\n`, "utf8");
    }
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(now);
  });
});
