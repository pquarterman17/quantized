// Python-expression -> LaTeX for the custom-equation fit's read-only preview
// (audit P2.7 stretch: "pretty LaTeX rendering while Python remains editable
// source"). The typed text stays the ONLY source of truth -- it is what the
// validate/fit routes read and what a saved model stores. This module turns a
// COPY of it into LaTeX for display, and nothing is ever parsed back.
//
// It mirrors the backend grammar (`calc/fit_equation_syntax.py`) token for
// token, so the picture shows the tree the fit will evaluate, not a guess:
//   - an optional `y =` / `f(x) =` left-hand side is stripped;
//   - `**` is `^`, right-associative (`2^3^2` is 2^(3^2), as pinned by the
//     backend's `test_exponent_chain_associativity_is_pinned`);
//   - a minus at the start or after `(` is the historical `0 - operand`
//     (binds looser than `*`), one after an operator is a prefix negation
//     that binds tighter than `*` and looser than `^`; unary plus is dropped;
//   - one-argument functions only, no implicit multiplication, only space and
//     tab count as whitespace.
// Anything the backend would reject, and the few things it accepts but this
// cannot draw faithfully (non-ASCII digits; names with characters other than
// ASCII letters/digits/`_`, Greek letters and subscript digits), yield null:
// the caller shows no preview. Nothing here throws.
//
// Names: a Greek-named parameter (`tau`, `Delta`) becomes the letter; `x_0`
// and trailing digits (`A0`, `tau12`) become subscripts; any other multi-letter
// name is set upright (`\mathrm{amp}`) so it does not read as a product.
// Division is `\frac` except inside an exponent, where it stays inline
// (`e^{-x/\tau}`).

/** The grammar's functions (`FUNCTION_NAMES`), each with its LaTeX form. */
const FUNCTIONS = new Map<string, (arg: string) => string>(Object.entries({
  exp: (a) => `e^{${a}}`,
  log: (a) => `\\ln\\left(${a}\\right)`,
  log10: (a) => `\\log_{10}\\left(${a}\\right)`,
  sqrt: (a) => `\\sqrt{${a}}`,
  abs: (a) => `\\left|${a}\\right|`,
  floor: (a) => `\\left\\lfloor ${a}\\right\\rfloor`,
  ceil: (a) => `\\left\\lceil ${a}\\right\\rceil`,
  ...Object.fromEntries(
    [
      ["sin", "\\sin"], ["cos", "\\cos"], ["tan", "\\tan"], ["asin", "\\arcsin"], ["acos", "\\arccos"],
      ["atan", "\\arctan"], ["sinh", "\\sinh"], ["cosh", "\\cosh"], ["tanh", "\\tanh"], ["coth", "\\coth"],
      ["erf", "\\operatorname{erf}"], ["erfc", "\\operatorname{erfc}"], ["sign", "\\operatorname{sgn}"],
      ["round", "\\operatorname{round}"],
    ].map(([name, op]) => [name, (a: string) => `${op}\\left(${a}\\right)`]),
  ),
}));

/** The function names the preview draws (a test pins them to the backend's). */
export const PREVIEW_FUNCTION_NAMES: readonly string[] = [...FUNCTIONS.keys()];

const CONSTANTS = new Map([["pi", "\\pi"], ["e", "e"]]);

const GREEK = new Set([
  "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta", "theta", "vartheta",
  "iota", "kappa", "lambda", "mu", "nu", "xi", "pi", "varpi", "rho", "varrho", "sigma", "varsigma",
  "tau", "upsilon", "phi", "varphi", "chi", "psi", "omega",
  "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Upsilon", "Phi", "Psi", "Omega",
]);

// Python's `isalpha` / `isalnum`, as the backend tokenizer uses them.
const IDENT_START = /[\p{L}_]/u;
const IDENT_PART = /[\p{L}\p{N}_]/u;
// Characters a name may hold for the preview to draw it; none is special to
// LaTeX except `_`, which `nameToLatex` handles. Anything else -> no preview.
const DRAWABLE_NAME = /^[A-Za-z0-9_\u0391-\u03A9\u03B1-\u03C9\u2080-\u2089]+$/;
const ONE_LETTER = /^[A-Za-z\u0391-\u03A9\u03B1-\u03C9][\u2080-\u2089]*$/;
const PYTHON_FLOAT = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const LHS = /^\s*(y|f\(x\))\s*=\s*/;

type Op = "+" | "-" | "*" | "/" | "^";
type Tok =
  | { t: "num"; text: string; zero?: true }
  | { t: "sym"; tex: string }
  | { t: "fn"; name: string }
  | { t: "op"; op: Op }
  | { t: "neg" }
  | { t: "(" }
  | { t: ")" };

type Node =
  | { k: "num"; text: string; zero?: true }
  | { k: "sym"; tex: string }
  | { k: "call"; fn: string; arg: Node }
  | { k: "neg"; arg: Node }
  | { k: "bin"; op: Op; l: Node; r: Node };

/** Not a user-facing error: it only unwinds the parser to `null`. */
class NoPreview extends Error {}

function fail(): never {
  throw new NoPreview();
}

/** LaTeX for one parameter name, or null when it holds a character the
 *  preview does not draw. */
export function nameToLatex(name: string): string | null {
  if (!DRAWABLE_NAME.test(name)) return null;
  const parts = name.split("_");
  if (parts.some((p) => p === "")) return `\\mathrm{${name.replaceAll("_", "\\_")}}`;
  const subs = parts.slice(1);
  let base = parts[0];
  const digits = /^([^0-9]+)([0-9]+)$/.exec(base);
  if (digits) {
    base = digits[1];
    subs.unshift(digits[2]);
  }
  const sub = subs.length ? `_{${subs.map(subscriptPart).join(",")}}` : "";
  return wordToLatex(base) + sub;
}

function wordToLatex(word: string): string {
  if (GREEK.has(word)) return `\\${word}`;
  // Braced when it carries a Unicode subscript digit, so a following `_{}`
  // or `^{}` lands on the group instead of forming a double subscript.
  if (ONE_LETTER.test(word)) return word.length === 1 ? word : `{${word}}`;
  return `\\mathrm{${word}}`;
}

function subscriptPart(part: string): string {
  return /^[0-9]+$/.test(part) ? part : wordToLatex(part);
}

function tokenize(src: string): Tok[] {
  const s = Array.from(src); // code points, like the backend's str indexing
  const out: Tok[] = [];
  let prev: "start" | "value" | "operator" | "lparen" | "function" = "start";
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === " " || ch === "\t") {
      i += 1;
    } else if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(s[i + 1] ?? ""))) {
      const start = i;
      while (i < s.length && (/\p{N}/u.test(s[i]) || s[i] === ".")) i += 1;
      if (s[i] === "e" || s[i] === "E") {
        i += 1;
        if (s[i] === "+" || s[i] === "-") i += 1;
        while (i < s.length && /\p{N}/u.test(s[i])) i += 1;
      }
      const text = s.slice(start, i).join("");
      if (!PYTHON_FLOAT.test(text)) fail(); // malformed, or a digit only Python reads
      out.push({ t: "num", text });
      prev = "value";
    } else if (IDENT_START.test(ch)) {
      const start = i;
      i += 1;
      while (i < s.length && IDENT_PART.test(s[i])) i += 1;
      const name = s.slice(start, i).join("");
      if (FUNCTIONS.has(name)) {
        out.push({ t: "fn", name });
        prev = "function";
        continue;
      }
      const tex = CONSTANTS.get(name) ?? (name === "x" ? "x" : nameToLatex(name));
      if (tex === null) fail();
      out.push({ t: "sym", tex });
      prev = "value";
    } else if (ch === "*" && s[i + 1] === "*") {
      out.push({ t: "op", op: "^" });
      prev = "operator";
      i += 2;
    } else if ("+-*/^()".includes(ch)) {
      if (ch === "(") {
        out.push({ t: "(" });
        prev = "lparen";
      } else if (ch === ")") {
        out.push({ t: ")" });
        prev = "value";
      } else if (ch === "-" && (prev === "start" || prev === "lparen")) {
        out.push({ t: "num", text: "0", zero: true }, { t: "op", op: "-" }); // historical "0 -"
        prev = "operator";
      } else if (ch === "-" && prev === "operator") {
        out.push({ t: "neg" });
      } else if (ch !== "+" || (prev !== "start" && prev !== "lparen" && prev !== "operator")) {
        out.push({ t: "op", op: ch as Op });
        prev = "operator";
      } // else: unary plus is the identity
      i += 1;
    } else {
      fail(); // includes "," -- every function takes exactly one argument
    }
  }
  return out;
}

/** Recursive descent with the backend shunting-yard's precedences:
 *  `+ -` < `* /` < prefix negation < `^` (right-associative). */
function parse(tokens: Tok[]): Node {
  let pos = 0;
  const peek = (): Tok | undefined => tokens[pos];
  const isOp = (...ops: Op[]): boolean => {
    const tok = peek();
    return tok?.t === "op" && ops.includes(tok.op);
  };
  const takeOp = (): Op => {
    const tok = tokens[pos++];
    return tok.t === "op" ? tok.op : fail();
  };

  function sum(): Node {
    let l = term();
    while (isOp("+", "-")) l = { k: "bin", op: takeOp(), l, r: term() };
    return l;
  }
  function term(): Node {
    let l = factor();
    while (isOp("*", "/")) l = { k: "bin", op: takeOp(), l, r: factor() };
    return l;
  }
  function factor(): Node {
    if (peek()?.t === "neg") {
      pos += 1;
      return { k: "neg", arg: factor() };
    }
    return power();
  }
  function power(): Node {
    const base = atom();
    if (!isOp("^")) return base;
    pos += 1;
    return { k: "bin", op: "^", l: base, r: exponent() };
  }
  // A sign after `^` binds the rest of the power chain: 2^-3^2 = 2^(-(3^2)).
  function exponent(): Node {
    if (peek()?.t === "neg") {
      pos += 1;
      return { k: "neg", arg: exponent() };
    }
    return power();
  }
  function closeParen(): void {
    if (tokens[pos++]?.t !== ")") fail();
  }
  function atom(): Node {
    const tok = tokens[pos++];
    if (tok === undefined) fail();
    if (tok.t === "num") return { k: "num", text: tok.text, zero: tok.zero };
    if (tok.t === "sym") return { k: "sym", tex: tok.tex };
    if (tok.t === "fn") {
      if (tokens[pos++]?.t !== "(") fail();
      const arg = sum();
      closeParen();
      return { k: "call", fn: tok.name, arg };
    }
    if (tok.t === "(") {
      const inner = sum();
      closeParen();
      return inner;
    }
    return fail();
  }

  const tree = sum();
  if (pos !== tokens.length) fail();
  return tree;
}

// Binding strength of a rendered piece, for deciding where parentheses go.
const ADD = 1;
const MUL = 2;
const NEG = 2.5;
const POW = 3;
const ATOM = 4;

interface Tex {
  tex: string;
  prec: number;
  /** Starts with a minus sign (needs parentheses after an operator). */
  lead?: boolean;
  /** Starts with a digit (a juxtaposed product would merge the numbers). */
  num?: boolean;
  kind?: "frac" | "slash" | "number";
}

const paren = (p: Tex): string => `\\left(${p.tex}\\right)`;
const wrapIf = (p: Tex, cond: boolean): string => (cond ? paren(p) : p.tex);

function numberTex(text: string): Tex {
  const [mantissa, exp] = text.split(/[eE]/);
  if (exp === undefined) return { tex: text, prec: ATOM, num: true, kind: "number" };
  const power = `10^{${exp.replace(/^\+/, "").replace(/^(-?)0+(?=\d)/, "$1")}}`;
  if (mantissa === "1") return { tex: power, prec: POW, num: true };
  return { tex: `${mantissa} \\times ${power}`, prec: MUL, num: true };
}

function render(node: Node, sup: boolean): Tex {
  switch (node.k) {
    case "num":
      return numberTex(node.text);
    case "sym":
      return { tex: node.tex, prec: ATOM };
    case "call":
      return {
        tex: (FUNCTIONS.get(node.fn) ?? fail)(render(node.arg, sup || node.fn === "exp").tex),
        prec: node.fn === "exp" ? POW : ATOM,
      };
    case "neg": {
      const a = render(node.arg, sup);
      return { tex: `-${wrapIf(a, a.lead === true || (a.prec < NEG && a.kind !== "frac"))}`, prec: NEG, lead: true };
    }
    case "bin":
      return renderBinary(node.op, node.l, node.r, sup);
  }
}

function renderBinary(op: Op, ln: Node, rn: Node, sup: boolean): Tex {
  if (op === "^") {
    const l = render(ln, sup);
    const wrap = l.prec < ATOM || l.lead === true;
    return { tex: `${wrapIf(l, wrap)}^{${render(rn, true).tex}}`, prec: POW, num: !wrap && l.num };
  }
  const r = render(rn, sup);
  if (op === "-" && ln.k === "num" && ln.zero) {
    // The leading-minus encoding `0 - operand`: drawn as a sign, binding like `-`.
    return { tex: `-${wrapIf(r, r.lead === true || r.prec <= ADD)}`, prec: ADD, lead: true };
  }
  const l = render(ln, sup);
  if (op === "+" || op === "-") {
    return { tex: `${l.tex} ${op} ${wrapIf(r, r.lead === true || r.prec <= ADD)}`, prec: ADD, lead: l.lead, num: l.num };
  }
  if (op === "/" && !sup) return { tex: `\\frac{${l.tex}}{${r.tex}}`, prec: MUL, kind: "frac" };
  if (op === "/") {
    const left = wrapIf(l, l.prec < MUL);
    return { tex: `${left}/${wrapIf(r, r.lead === true || r.prec <= MUL)}`, prec: MUL, lead: l.lead, kind: "slash" };
  }
  // "*": juxtapose, except where that would merge digits or read as a mixed number.
  const wrapL = (l.prec < MUL && l.kind !== "frac") || l.kind === "slash";
  const wrapR = (r.prec < MUL && r.kind !== "frac") || r.lead === true || r.kind === "slash";
  const dot = (!wrapR && r.num === true) || (r.kind === "frac" && l.kind === "number");
  const tex = `${wrapIf(l, wrapL)}${dot ? " \\cdot " : "\\,"}${wrapIf(r, wrapR)}`;
  return { tex, prec: MUL, lead: !wrapL && l.lead, num: !wrapL && l.num };
}

/** LaTeX for an equation in the fit's Python-flavoured syntax, as
 *  `y = ...` (or `f(x) = ...` when typed that way), or null when the text is
 *  empty, invalid, or holds something the preview cannot draw faithfully.
 *  Never throws. */
export function equationToLatex(text: string): string | null {
  try {
    const stripped = text.trim();
    const lhs = LHS.exec(stripped);
    const expr = stripped.slice(lhs ? lhs[0].length : 0);
    if (!expr) return null;
    const body = render(parse(tokenize(expr)), false).tex;
    return `${lhs?.[1] === "f(x)" ? "f(x)" : "y"} = ${body}`;
  } catch {
    // NoPreview for anything unparseable; also a pathological nesting depth
    // (RangeError) -- a preview must never take the editor down.
    return null;
  }
}
