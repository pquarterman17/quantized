// Origin-style rich-text escapes -> the `$...$` mathtext subset (publication-
// figures audit #17). The SCREEN half of one rendering contract: the export
// applies the identical rewrite in `calc/figure_origin_escapes.py`, and both
// halves are pinned by the shared fixture `tests/fixtures/wire/origin_escapes.json`
// (`originEscapes.test.ts` / `tests/test_figure_origin_escapes.py`). The
// syntax is documented for the toolbar that inserts it in
// docs/rich_text_labels.md:
//
//   \+(text)  superscript   -> $^{\mathrm{text}}$
//   \-(text)  subscript     -> $_{\mathrm{text}}$
//   \g(text)  Greek         -> the Unicode Greek letters (Origin Symbol map)
//   \b(text)  bold          -> $\mathbf{text}$
//   \i(text)  italic        -> $\mathit{text}$
//
// Runs nest and their parentheses balance. Only text OUTSIDE `$...$` is
// rewritten. A run whose text holds a mathtext-syntax character, an
// unterminated run or an unknown control stays exactly as typed (literal).
// Pure: string in -> string out.

/** Origin's Symbol font: Latin key -> the Greek glyph it displays. */
const GREEK: Record<string, string> = {
  a: "α", b: "β", g: "γ", d: "δ", e: "ε", z: "ζ", h: "η", q: "θ", i: "ι", k: "κ",
  l: "λ", m: "μ", n: "ν", x: "ξ", o: "ο", p: "π", r: "ρ", s: "σ", t: "τ", u: "υ",
  f: "φ", c: "χ", y: "ψ", w: "ω", v: "ς", j: "ϕ",
  A: "Α", B: "Β", G: "Γ", D: "Δ", E: "Ε", Z: "Ζ", H: "Η", Q: "Θ", I: "Ι", K: "Κ",
  L: "Λ", M: "Μ", N: "Ν", X: "Ξ", O: "Ο", P: "Π", R: "Ρ", S: "Σ", T: "Τ", U: "Υ",
  F: "Φ", C: "Χ", Y: "Ψ", W: "Ω",
};

const CONTROLS = "+-gbi";
// An escape is a backslash NOT itself escaped: `\\+(2)` is a literal
// backslash then "+(2)" (review finding: it became `\$^{...}$`).
const ESCAPE = /(?<!\\)\\[+\-gbi]\(/;
// The run text richtext.ts' math subset accepts (emitMathChar: letters,
// digits, MATH_PUNCT, MATH_UNICODE, the Greek glyphs, '-', "'" and spaces).
// A run holding anything else stays literal on BOTH sides (review finding:
// accented letters, @, ? rendered as math in the export, literally here).
const MATH_SAFE = new Set([..."+=/()[]|.,:;!*<>-' °Åµ×±⋅∘′″−"]);
const GREEK_GLYPHS = new Set(Object.values(GREEK));
const safe = (c: string): boolean => /^[A-Za-z0-9]$/.test(c) || MATH_SAFE.has(c) || GREEK_GLYPHS.has(c);
type Style = "rm" | "bf" | "it";

class Literal extends Error {}

/** Does `label` contain an Origin run escape? */
export function hasOriginEscape(label: string): boolean {
  return ESCAPE.test(label);
}

function close(s: string, openAt: number): number {
  let depth = 0;
  for (let j = openAt; j < s.length; j += 1) {
    if (s[j] === "(") depth += 1;
    else if (s[j] === ")") {
      depth -= 1;
      if (depth === 0) return j;
    }
  }
  throw new Literal();
}

const greek = (body: string) => [...body].map((c) => GREEK[c] ?? c).join("");

function mathText(text: string, style: Style): string {
  if (![...text].every(safe)) throw new Literal();
  const body = text.replaceAll(" ", "\\ ");
  return style === "rm" ? `\\mathrm{${body}}` : body;
}

function math(s: string, style: Style): string {
  let out = "";
  let plain = "";
  let i = 0;
  while (i < s.length) {
    const nested = s[i] === "\\" && i + 2 < s.length && CONTROLS.includes(s[i + 1]) && s[i + 2] === "(";
    if (nested && !(i > 0 && s[i - 1] === "\\")) {
      if (plain) out += mathText(plain, style);
      plain = "";
      const end = close(s, i + 2);
      out += run(s[i + 1], s.slice(i + 3, end), style);
      i = end + 1;
      continue;
    }
    plain += s[i];
    i += 1;
  }
  return plain ? out + mathText(plain, style) : out;
}

function run(control: string, body: string, style: Style): string {
  if (control === "g") return mathText(greek(body), style);
  if (control === "b") return `\\mathbf{${math(body, "bf")}}`;
  if (control === "i") return `\\mathit{${math(body, "it")}}`;
  return `${control === "+" ? "^" : "_"}{${math(body, style)}}`;
}

function convertPlain(s: string): string {
  let out = "";
  let i = 0;
  const re = new RegExp(ESCAPE.source, "g");
  while (i < s.length) {
    re.lastIndex = i;
    const m = re.exec(s);
    if (!m) {
      out += s.slice(i);
      break;
    }
    out += s.slice(i, m.index);
    const control = s[m.index + 1];
    const openAt = m.index + m[0].length - 1;
    let end: number;
    try {
      end = close(s, openAt);
    } catch (e) {
      if (!(e instanceof Literal)) throw e;
      out += m[0]; // unterminated: the prefix stays as typed
      i = m.index + m[0].length;
      continue;
    }
    const body = s.slice(openAt + 1, end);
    try {
      if (control === "g") {
        if (body.includes("\\")) throw new Literal(); // a nested run inside Greek is not Origin's
        out += greek(body);
      } else {
        out += `$${run(control, body, "rm")}$`;
      }
    } catch (e) {
      if (!(e instanceof Literal)) throw e;
      // The WHOLE balanced run stays as typed: converting the runs nested in
      // it would half-convert it (review finding: nested Greek / bold runs).
      out += s.slice(m.index, end + 1);
    }
    i = end + 1;
  }
  return out;
}

/** `label` with its Origin escapes rewritten into the `$...$` subset;
 *  unchanged when it has none (or an odd `$` count — rendered literally). */
export function originEscapesToMarkup(label: string): string {
  if (!label || !hasOriginEscape(label)) return label;
  const parts = label.split(/(?<!\\)\$/);
  if (parts.length % 2 === 0) return label;
  return parts.map((p, k) => (k % 2 ? p : convertPlain(p))).join("$");
}
