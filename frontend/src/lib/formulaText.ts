// Text functions for the worksheet formula language (gap audit 9, G16). Part
// of the LAZY formula chunk: lib/formulaRefs.ts calls `tryParseTextCall` from
// its `tryParseCall`.
//
// DESIGN (provisional, owner to confirm — plans/FORMULA_TEXT_DESIGN.md). A
// formula column holds NUMBERS (`FormulaFn` returns a number; computed columns
// are `DataStruct.values` floats). Changing that is an architecture change, so
// text lives only INSIDE a numeric result: the text-consuming functions below
// return a number, and the text-producing ones (upper, left, mid, replace,
// regex_extract, str, format_date …) are legal only as their arguments:
//
//   len(col("Sample"))                              characters
//   num(regex_extract(col("Sample"), "(\d+)K", 1))  "NbFe 300K" -> 300
//   contains(lower(col("Notes")), "anneal")         1 / 0
//
// A text-producing function at the top level of a column is refused with a
// message saying so. A text-valued result COLUMN (a categorical write path)
// is the design note's open item.
//
// Text arguments: a "string literal" (no escapes; use the other quote to
// include one), col("Name") for a text column, a bare categorical column
// letter (its row's LEVEL label), or a text function. A numeric column is not
// text: wrap it in str(). Characters are Unicode CODE POINTS (len("é😀") is 2,
// like Python's len, not UTF-16 units). Every position is 1-based (JMP Substr,
// Excel MID).
//
// Consuming (number out; a missing input gives NaN):
//   len(s)  contains(s, sub) startswith(s, sub) endswith(s, sub)   1 / 0
//   find(s, sub)     1-based position of the first match, 0 if none (JMP
//                    Contains(s, sub) returns the position)
//   regex_match(s, "pattern")   1 when the pattern matches ANYWHERE in s
//   num(s)           text -> number; missing when s is not a plain decimal
//                    (optional sign, digits, point, exponent; spaces around
//                    are ignored; no thousands separators, hex, inf or nan)
//   parse_date(s)    ISO 8601 -> epoch seconds UTC, missing when not a date
// Producing (text out; only inside the above):
//   upper lower trim left(s,n) right(s,n) mid(s,start,len) substr (= mid)
//   concat(a, b, …)  replace(s, old, new) (literal, every occurrence)
//   regex_extract(s, "pattern" [, group])   group 1 if the pattern has one,
//                    else the whole match; no match = missing
//   str(v [, "%.3f"]) number -> text; default is the shortest exact form
//                    (300 -> "300", 1.5 -> "1.5"); format is %d, %f, %e or %g
//                    with an optional .precision; a missing v = missing.
//                    Exact decimal ties (0.125 at %.2f) round AWAY from zero
//                    as JavaScript does; Python rounds them to even.
//   format_date(t)   epoch seconds -> "YYYY-MM-DD HH:MM:SS" UTC
//
// Missing: a text value is missing (null) for a missing categorical code, a
// missing number, or a failed extract; it propagates through every function
// (an EMPTY string is a value, not missing: len("") is 0). left/right/mid
// with a negative or non-integer count/start are missing — never wrapped the
// way Python slicing would.
//
// Regular expressions are the JavaScript dialect (unicode mode). The common
// subset (classes, groups, quantifiers, anchors, alternation) agrees with
// Python's `re`; lookbehind, named groups and inline flags can differ and
// are not part of the pinned behaviour. A pattern is written in the formula
// (a literal), compiled when the formula is entered, and a bad one is refused
// then.
//
// References: JMP Scripting Guide, Character functions
// (https://www.jmp.com/support/help/en/18.2/jmp/character-functions.shtml):
// Length, Uppercase, Lowercase, Trim, Left, Right, Substr, Concat, Contains,
// Starts With, Ends With, Substitute, Regex, Num; Origin LabTalk string
// functions (https://www.originlab.com/doc/LabTalk/ref/String-Functions):
// strlen, left, right, mid, find, replace, ... (names matched where they
// agree; unverified, owner to check).

import { parseIsoDate, formatIso } from "./formulaCalendar";
import type { FormulaFn, FormulaRowContext, Tok } from "./formulaTypes";
import type { ParserOps } from "./formulaRowFns";

/** A row's text value; null = missing. */
type TextFn = (c: Record<string, number>, ex: FormulaRowContext | undefined) => string | null;

const isOp = (t: Tok | undefined, v: string): boolean => !!t && t.t === "op" && t.v === v;
const cps = (s: string): string[] => Array.from(s);

export const TEXT_PRODUCERS: ReadonlySet<string> = new Set([
  "upper",
  "lower",
  "trim",
  "left",
  "right",
  "mid",
  "substr",
  "concat",
  "replace",
  "regex_extract",
  "str",
  "format_date",
]);
const CONSUMERS: ReadonlySet<string> = new Set(["len", "contains", "startswith", "endswith", "find", "regex_match", "num", "parse_date"]);
export const TEXT_FUNCTION_NAMES: readonly string[] = [...CONSUMERS, ...TEXT_PRODUCERS];

// ── text arguments ──────────────────────────────────────────────────────

/** One text argument. `reads` is set when it reads the row's text/level
 *  tables (not supplied to a single-row incremental recompute). */
function parseText(ops: ParserOps, owner: string, reads: { v: boolean }): TextFn {
  const t = ops.peek();
  if (t?.t === "str") {
    ops.eat();
    return () => t.v;
  }
  if (t?.t === "name" && t.v === "col" && isOp(ops.peekAt(1), "(") && ops.peekAt(2)?.t === "str" && isOp(ops.peekAt(3), ")")) {
    ops.eat();
    ops.eat();
    const name = (ops.eat() as Extract<Tok, { t: "str" }>).v;
    ops.eat();
    reads.v = true;
    return (_c, ex) => {
      const cells = ex?.text?.[name];
      if (!cells) throw new Error(`no text column named "${name}" (a numeric column is not text: use str())`);
      return cells[ex.row] ?? "";
    };
  }
  if (t?.t === "name" && isOp(ops.peekAt(1), "(") && TEXT_PRODUCERS.has(t.v)) {
    ops.eat();
    ops.eat();
    return parseProducer(t.v, ops, reads);
  }
  if (t?.t === "name" && !isOp(ops.peekAt(1), "(") && !isOp(ops.peekAt(1), "[")) {
    ops.eat();
    ops.ref(t.v);
    reads.v = true;
    const col = t.v;
    return (c, ex) => {
      const levels = ex?.levels?.[col];
      if (!levels) {
        if (c[col] === undefined) throw new Error(`unknown variable "${col}"`);
        throw new Error(`${col} is a numeric column, not text — use str(${col}) to turn it into text`);
      }
      const code = c[col];
      return Number.isInteger(code) && code >= 0 && code < levels.length ? levels[code] : null;
    };
  }
  throw new Error(`${owner}() expects text here: a "quoted string", col("Text column"), a categorical column or a text function such as upper() / str()`);
}

/** A number argument (any numeric expression). */
const parseNum = (ops: ParserOps): FormulaFn => ops.parseExpr();

const literalString = (ops: ParserOps, owner: string, what: string): string => {
  const t = ops.eat();
  if (t?.t !== "str") throw new Error(`${owner}() expects ${what} written in quotes`);
  return t.v;
};

function compileRegex(owner: string, pattern: string): RegExp {
  try {
    return new RegExp(pattern, "u");
  } catch (e) {
    throw new Error(`${owner}(): bad pattern "${pattern}" — ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ── number formatting for str() ────────────────────────────────────────

const FORMAT = /^%(?:\.(\d{1,2}))?([dfeg])$/;

/** toFixed that stays positional past 1e21 (JS switches to exponent there; C and Python do not). */
function fixed(v: number, p: number): string {
  if (Math.abs(v) < 1e21) return v.toFixed(p);
  return BigInt(v).toString() + (p > 0 ? `.${"0".repeat(p)}` : "");
}

function formatNumber(v: number, spec: RegExpExecArray | null): string {
  if (!spec) return Number.isInteger(v) && Math.abs(v) < 1e21 ? v.toFixed(0) : String(v);
  const p = spec[1] === undefined ? undefined : Number(spec[1]);
  switch (spec[2]) {
    case "d":
      return fixed(Math.round(v), 0);
    case "f":
      return fixed(v, p ?? 6);
    case "e":
      return v.toExponential(p ?? 6).replace(/e([+-])(\d)$/, "e$10$2"); // Python/C: two exponent digits
    default: {
      // %g: p significant digits (default 6), trailing zeros dropped
      const sig = Math.max(p ?? 6, 1);
      const exp = Math.floor(Math.log10(Math.abs(v)));
      const useExp = v !== 0 && (exp < -4 || exp >= sig);
      const s = useExp ? v.toExponential(sig - 1) : v.toPrecision(sig);
      const trimmed = s.includes("e") ? s.replace(/\.?0+e/, "e") : s.includes(".") ? s.replace(/\.?0+$/, "") : s;
      return trimmed.replace(/e([+-])(\d)$/, "e$10$2");
    }
  }
}

// ── text-producing functions ────────────────────────────────────────────

function parseProducer(fname: string, ops: ParserOps, reads: { v: boolean }): TextFn {
  const text = () => parseText(ops, fname, reads);
  const comma = () => ops.expectOp(",");
  const intOf = (v: number, min: number): number | null => (Number.isInteger(v) && v >= min ? v : null);
  switch (fname) {
    case "upper":
    case "lower":
    case "trim": {
      const s = text();
      ops.expectOp(")");
      const f = fname === "upper" ? (v: string) => v.toUpperCase() : fname === "lower" ? (v: string) => v.toLowerCase() : (v: string) => v.trim();
      return (c, ex) => ((v) => (v === null ? null : f(v)))(s(c, ex));
    }
    case "left":
    case "right": {
      const s = text();
      comma();
      const n = parseNum(ops);
      ops.expectOp(")");
      return (c, ex) => {
        const v = s(c, ex);
        const k = intOf(n(c, ex), 0);
        if (v === null || k === null) return null;
        const a = cps(v);
        return (fname === "left" ? a.slice(0, k) : a.slice(Math.max(a.length - k, 0))).join("");
      };
    }
    case "mid":
    case "substr": {
      const s = text();
      comma();
      const start = parseNum(ops);
      comma();
      const len = parseNum(ops);
      ops.expectOp(")");
      return (c, ex) => {
        const v = s(c, ex);
        const i = intOf(start(c, ex), 1);
        const k = intOf(len(c, ex), 0);
        return v === null || i === null || k === null ? null : cps(v).slice(i - 1, i - 1 + k).join("");
      };
    }
    case "concat": {
      const parts = [text()];
      while (isOp(ops.peek(), ",")) {
        ops.eat();
        parts.push(text());
      }
      ops.expectOp(")");
      return (c, ex) => {
        let out = "";
        for (const p of parts) {
          const v = p(c, ex);
          if (v === null) return null;
          out += v;
        }
        return out;
      };
    }
    case "replace": {
      const s = text();
      comma();
      const from = text();
      comma();
      const to = text();
      ops.expectOp(")");
      return (c, ex) => {
        const [v, a, b] = [s(c, ex), from(c, ex), to(c, ex)];
        return v === null || a === null || b === null ? null : a === "" ? v : v.split(a).join(b);
      };
    }
    case "regex_extract": {
      const s = text();
      comma();
      const re = compileRegex(fname, literalString(ops, fname, "the pattern"));
      let group: number | undefined;
      if (isOp(ops.peek(), ",")) {
        ops.eat();
        const g = ops.eat();
        if (g?.t !== "num" || !Number.isInteger(g.v) || g.v < 0) throw new Error("regex_extract() group must be a whole number written in the formula, e.g. 1");
        group = g.v;
      }
      ops.expectOp(")");
      const groups = new RegExp(`${re.source}|`, "u").exec("")?.length ?? 1; // capture groups + 1
      if (group !== undefined && group >= groups) throw new Error(`regex_extract(): the pattern has ${groups - 1} group(s), not ${group}`);
      const g = group ?? (groups > 1 ? 1 : 0);
      return (c, ex) => {
        const v = s(c, ex);
        const m = v === null ? null : re.exec(v);
        return m?.[g] ?? null;
      };
    }
    case "str": {
      const v = parseNum(ops);
      let spec: RegExpExecArray | null = null;
      if (isOp(ops.peek(), ",")) {
        ops.eat();
        const f = literalString(ops, fname, 'a format such as "%.3f"');
        spec = FORMAT.exec(f);
        if (!spec) throw new Error(`str(): unsupported format "${f}" — use %d, %f, %e or %g with an optional precision, e.g. "%.3f"`);
      }
      ops.expectOp(")");
      const picked = spec;
      return (c, ex) => ((x) => (Number.isFinite(x) ? formatNumber(x, picked) : null))(v(c, ex));
    }
    default: {
      // format_date
      const t = parseNum(ops);
      ops.expectOp(")");
      return (c, ex) => formatIso(t(c, ex));
    }
  }
}

// ── text-consuming functions (the numeric entry points) ─────────────────

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

const bool = (b: boolean): number => (b ? 1 : 0);

/** `fname(` (name and paren eaten) as a text function, or undefined. A
 *  text-PRODUCING one here is refused: it would be a text column. */
export function tryParseTextCall(fname: string, ops: ParserOps): FormulaFn | undefined {
  if (TEXT_PRODUCERS.has(fname)) {
    throw new Error(
      `${fname}() returns text, but a formula column holds numbers — use it inside len(), num(), contains(), startswith(), endswith(), find(), regex_match() or parse_date(), e.g. num(${fname}(…))`,
    );
  }
  if (!CONSUMERS.has(fname)) return undefined;
  const reads = { v: false };
  const text = () => parseText(ops, fname, reads);
  let fn: FormulaFn;
  switch (fname) {
    case "len": {
      const s = text();
      fn = (c, ex) => ((v) => (v === null ? NaN : cps(v).length))(s(c, ex));
      break;
    }
    case "num":
    case "parse_date": {
      const s = text();
      const f = fname === "num" ? (v: string) => (NUMBER.test(v.trim()) ? Number(v.trim()) : NaN) : parseIsoDate;
      fn = (c, ex) => ((v) => (v === null ? NaN : f(v)))(s(c, ex));
      break;
    }
    case "regex_match": {
      const s = text();
      ops.expectOp(",");
      const re = compileRegex(fname, literalString(ops, fname, "the pattern"));
      fn = (c, ex) => ((v) => (v === null ? NaN : bool(re.test(v))))(s(c, ex));
      break;
    }
    default: {
      // contains / startswith / endswith / find: (s, sub)
      const s = text();
      ops.expectOp(",");
      const sub = text();
      const f: (v: string, w: string) => number =
        fname === "contains"
          ? (v, w) => bool(v.includes(w))
          : fname === "startswith"
            ? (v, w) => bool(v.startsWith(w))
            : fname === "endswith"
              ? (v, w) => bool(v.endsWith(w))
              : (v, w) => ((i) => (i < 0 ? 0 : cps(v.slice(0, i)).length + 1))(v.indexOf(w));
      fn = (c, ex) => {
        const [v, w] = [s(c, ex), sub(c, ex)];
        return v === null || w === null ? NaN : f(v, w);
      };
    }
  }
  ops.expectOp(")");
  // Reads the row's level table / text cells, which a single-row incremental
  // recompute does not supply (same rule as the text comparison).
  if (reads.v) ops.nonLocal("aggregate");
  return fn;
}
