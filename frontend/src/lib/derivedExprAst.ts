// P2.5 derived expressions — the worksheet formula language as a syntax TREE.
//
// lib/formula.ts compiles straight to closures, which is all evaluation needs.
// Deriving a column's UNIT and propagating ERRORS through it needs the tree, so
// this lazy module parses the same token stream (`tokenize`, shared) with the
// same grammar and the same function/constant tables (`formulaFuncs.ts`), and
// prints a tree back to text the evaluator compiles. It is only ever called on
// an expression `compileFormula` has already accepted, so its own errors are
// "cannot happen" guards rather than user-facing diagnostics; the parity tests
// (derivedExprAst.test.ts) check that `compileFormula(print(parse(e)))`
// evaluates exactly like `compileFormula(e)` across the grammar, precedence
// and associativity included.

import { AGGREGATE_NAMES } from "./formulaAggregates";
import { CONSTS, FUNCS } from "./formulaFuncs";
import { syntaxError, tokenize } from "./formulaTokenize";
import { COMPARE_OPS, type Tok } from "./formulaTypes";

export type BinOp = "+" | "-" | "*" | "/" | "//" | "%" | "^" | "**";

export type Node =
  | { k: "num"; v: number }
  | { k: "var"; name: string }
  | { k: "const"; name: string }
  | { k: "neg"; a: Node }
  | { k: "bin"; op: BinOp; a: Node; b: Node }
  | { k: "cmp"; op: string; a: Node; b: Node }
  | { k: "and" | "or"; a: Node; b: Node }
  | { k: "not"; a: Node }
  | { k: "call"; fn: string; args: Node[] }
  | { k: "if"; c: Node; a: Node; b: Node }
  | { k: "row" }
  | { k: "lag"; col: string; n: Node }
  | { k: "diff"; col: string }
  | { k: "agg"; fn: string; col: string; range?: [Node, Node] }
  | { k: "fit"; model: string; param: string }
  | { k: "fitval"; model: string; arg: Node }
  // Worksheet audit #17 (lib/formulaRefs.ts): `c ? a : b` parses to "if".
  | { k: "cumsum"; col: string }
  | { k: "index"; col: string; i: Node }
  | { k: "sheet"; name: string; col: string }
  | { k: "textcmp"; op: string; ref: string; textCol: boolean; value: string };

export function parseExpr(src: string): Node {
  const toks = tokenize(src);
  let pos = 0;
  const peek = (o = 0): Tok | undefined => toks[pos + o];
  const isOp = (t: Tok | undefined, v: string): boolean => !!t && t.t === "op" && t.v === v;
  const isKw = (t: Tok | undefined, v: string): boolean => !!t && t.t === "name" && t.v === v;
  const expect = (v: string): void => {
    if (!isOp(toks[pos++], v)) throw new Error(`expected "${v}"`);
  };
  const text = (): string => {
    const t = toks[pos++];
    if (!t || t.t !== "str") throw new Error("expected text in quotes");
    return t.v;
  };
  const bare = (): string => {
    const t = toks[pos++];
    if (!t || t.t !== "name") throw new Error("expected a bare column name");
    return t.v;
  };

  function ternary(): Node {
    const c = or();
    if (!isOp(peek(), "?")) return c;
    pos++;
    const a = ternary();
    expect(":");
    return { k: "if", c, a, b: ternary() };
  }
  /** `A == "x"` / `col("T") != "x"` / reversed — formulaRefs.tryParseTextCompare. */
  function textCmp(): Node | null {
    const refLen = (at: number): number => {
      const t = peek(at);
      if (isKw(t, "col") && isOp(peek(at + 1), "(") && peek(at + 2)?.t === "str" && isOp(peek(at + 3), ")")) return 4;
      if (t?.t === "name" && t.v !== "col" && !isOp(peek(at + 1), "(") && !isOp(peek(at + 1), "[")) return 1;
      return 0;
    };
    const isEq = (at: number): boolean => isOp(peek(at), "==") || isOp(peek(at), "!=");
    const readRef = (len: number): { ref: string; textCol: boolean } => {
      if (len === 1) return { ref: bare(), textCol: false };
      pos += 2;
      const ref = text();
      expect(")");
      return { ref, textCol: true };
    };
    const left = refLen(0);
    if (left && isEq(left) && peek(left + 1)?.t === "str") {
      const r = readRef(left);
      const op = String(toks[pos++].v);
      return { k: "textcmp", op, ...r, value: text() };
    }
    if (peek()?.t === "str" && isEq(1) && refLen(2)) {
      const value = text();
      const op = String(toks[pos++].v);
      return { k: "textcmp", op, ...readRef(refLen(0)), value };
    }
    return null;
  }
  function or(): Node {
    let a = and();
    while (isKw(peek(), "or")) {
      pos++;
      a = { k: "or", a, b: and() };
    }
    return a;
  }
  function and(): Node {
    let a = not();
    while (isKw(peek(), "and")) {
      pos++;
      a = { k: "and", a, b: not() };
    }
    return a;
  }
  function not(): Node {
    if (isKw(peek(), "not")) {
      pos++;
      return { k: "not", a: not() };
    }
    const tc = textCmp();
    if (tc) return tc;
    const a = arith();
    const t = peek();
    if (t && t.t === "op" && COMPARE_OPS.has(t.v)) {
      pos++;
      return { k: "cmp", op: t.v, a, b: arith() };
    }
    return a;
  }
  function arith(): Node {
    let a = term();
    for (let t = peek(); isOp(t, "+") || isOp(t, "-"); t = peek()) {
      pos++;
      a = { k: "bin", op: t!.v as BinOp, a, b: term() };
    }
    return a;
  }
  function term(): Node {
    let a = power();
    for (let t = peek(); t && t.t === "op" && ["*", "/", "%", "//"].includes(t.v); t = peek()) {
      pos++;
      a = { k: "bin", op: t.v as BinOp, a, b: power() };
    }
    return a;
  }
  function power(): Node {
    const a = unary();
    if (!isOp(peek(), "^")) return a;
    pos++;
    return { k: "bin", op: "^", a, b: power() };
  }
  function unary(): Node {
    const t = peek();
    if (isOp(t, "-") || isOp(t, "+")) {
      pos++;
      const a = unary();
      return t!.v === "-" ? { k: "neg", a } : a;
    }
    const a = atom();
    if (!isOp(peek(), "**")) return a;
    pos++;
    return { k: "bin", op: "**", a, b: unary() };
  }
  function atom(): Node {
    const t = toks[pos++];
    if (!t) throw new Error("unexpected end of expression");
    if (t.t === "num") return { k: "num", v: t.v };
    if (isOp(t, "(")) {
      const e = ternary();
      expect(")");
      return e;
    }
    if (t.t !== "name") throw new Error(`unexpected token "${t.v}"`);
    if (isOp(peek(), "(")) {
      pos++;
      return call(t.v);
    }
    if (Object.hasOwn(CONSTS, t.v)) return { k: "const", name: t.v };
    if (isOp(peek(), "[")) {
      pos++;
      const i = ternary();
      expect("]");
      return { k: "index", col: t.v, i };
    }
    return { k: "var", name: t.v };
  }
  function args(): Node[] {
    const out: Node[] = [];
    if (!isOp(peek(), ")")) {
      out.push(ternary());
      while (isOp(peek(), ",")) {
        pos++;
        out.push(ternary());
      }
    }
    expect(")");
    return out;
  }
  function call(fn: string): Node {
    if (fn === "if" || fn === "where") {
      const [c, a, b] = args();
      if (!b) throw new Error(`${fn}() takes three arguments`);
      return { k: "if", c, a, b };
    }
    if (fn === "row") {
      expect(")");
      return { k: "row" };
    }
    if (fn === "lag") {
      const col = bare();
      expect(",");
      const n = ternary();
      expect(")");
      return { k: "lag", col, n };
    }
    if (fn === "diff") {
      const col = bare();
      expect(")");
      return { k: "diff", col };
    }
    const first = peek();
    if (
      AGGREGATE_NAMES.has(fn) &&
      first?.t === "name" &&
      !Object.hasOwn(CONSTS, first.v) &&
      isOp(peek(1), ")")
    ) {
      pos += 2;
      return { k: "agg", fn, col: first.v };
    }
    if (AGGREGATE_NAMES.has(fn) && first?.t === "name" && !Object.hasOwn(CONSTS, first.v) && isOp(peek(1), "[")) {
      pos += 2;
      const from = ternary();
      expect(":");
      const to = ternary();
      expect("]");
      expect(")");
      return { k: "agg", fn, col: first.v, range: [from, to] };
    }
    if (fn === "cumsum") {
      const col = bare();
      expect(")");
      return { k: "cumsum", col };
    }
    if (fn === "sheet") {
      const name = text();
      expect(",");
      const col = bare();
      expect(")");
      return { k: "sheet", name, col };
    }
    if (fn === "fit") {
      const model = text();
      let param: string;
      if (isOp(peek(), ",")) {
        pos++;
        param = text();
        expect(")");
      } else {
        expect(")");
        expect(".");
        param = bare();
      }
      return { k: "fit", model, param };
    }
    if (fn === "fitval") {
      const model = text();
      expect(",");
      const arg = ternary();
      expect(")");
      return { k: "fitval", model, arg };
    }
    if (!Object.hasOwn(FUNCS, fn)) throw syntaxError(`unknown function "${fn}"`, toks[pos - 2]?.p ?? 0);
    return { k: "call", fn, args: args() };
  }

  try {
    const root = ternary();
    if (pos !== toks.length) throw syntaxError("trailing characters in expression", toks[pos].p ?? 0);
    return root;
  } catch (e) {
    // Name the column: the token the parse stopped at (or the end).
    if (!(e instanceof Error) || /\(column \d+\)$/.test(e.message)) throw e;
    throw syntaxError(e.message, pos - 1 < toks.length ? (toks[Math.max(0, pos - 1)]?.p ?? 0) : src.length);
  }
}

// ── printing ────────────────────────────────────────────────────────────
// Binding strength, weakest first, matching the grammar levels above.
const PREC: Record<string, number> = { or: 1, and: 2, not: 3, cmp: 4, "+": 5, "-": 5, "*": 6, "/": 6, "//": 6, "%": 6, "^": 7, neg: 8, "**": 9 };

function precOf(n: Node): number {
  if (n.k === "num") return n.v < 0 || Object.is(n.v, -0) ? PREC.neg : 10;
  if (n.k === "bin") return PREC[n.op];
  if (n.k === "neg" || n.k === "not" || n.k === "cmp" || n.k === "and" || n.k === "or") return PREC[n.k];
  if (n.k === "textcmp") return PREC.cmp;
  return 10;
}

const quote = (s: string): string => (s.includes('"') ? `'${s}'` : `"${s}"`);

/** Print a tree back to formula text that parses to the same tree (up to
 *  redundant parentheses): a child is parenthesized whenever its binding is
 *  weaker than its slot requires. */
export function printExpr(n: Node): string {
  const wrap = (c: Node, min: number): string => (precOf(c) < min ? `(${printExpr(c)})` : printExpr(c));
  switch (n.k) {
    case "num":
      return n.v < 0 || Object.is(n.v, -0) ? `-${String(-n.v)}` : String(n.v);
    case "var":
    case "const":
      return n.name;
    case "neg":
      return `-${wrap(n.a, PREC.neg)}`;
    case "not":
      return `not ${wrap(n.a, PREC.not)}`;
    case "and":
    case "or":
      return `${wrap(n.a, PREC[n.k])} ${n.k} ${wrap(n.b, PREC[n.k] + 1)}`;
    case "cmp":
      return `${wrap(n.a, PREC["+"])} ${n.op} ${wrap(n.b, PREC["+"])}`;
    case "bin": {
      const p = PREC[n.op];
      if (n.op === "^") return `${wrap(n.a, PREC.neg)} ^ ${wrap(n.b, p)}`;
      if (n.op === "**") return `${wrap(n.a, 10)}**${wrap(n.b, PREC.neg)}`;
      return `${wrap(n.a, p)} ${n.op} ${wrap(n.b, p + 1)}`;
    }
    case "call":
      return `${n.fn}(${n.args.map(printExpr).join(", ")})`;
    case "if":
      return `if(${printExpr(n.c)}, ${printExpr(n.a)}, ${printExpr(n.b)})`;
    case "row":
      return "row()";
    case "lag":
      return `lag(${n.col}, ${printExpr(n.n)})`;
    case "diff":
      return `diff(${n.col})`;
    case "agg":
      return n.range ? `${n.fn}(${n.col}[${printExpr(n.range[0])}:${printExpr(n.range[1])}])` : `${n.fn}(${n.col})`;
    case "cumsum":
      return `cumsum(${n.col})`;
    case "index":
      return `${n.col}[${printExpr(n.i)}]`;
    case "sheet":
      return `sheet(${quote(n.name)}, ${n.col})`;
    case "textcmp":
      return `${n.textCol ? `col(${quote(n.ref)})` : n.ref} ${n.op} ${quote(n.value)}`;
    case "fit":
      return `fit(${quote(n.model)}, ${quote(n.param)})`;
    case "fitval":
      return `fitval(${quote(n.model)}, ${printExpr(n.arg)})`;
  }
}

/** Every child of a node, for generic walks. */
export function children(n: Node): Node[] {
  switch (n.k) {
    case "neg":
    case "not":
      return [n.a];
    case "bin":
    case "cmp":
    case "and":
    case "or":
      return [n.a, n.b];
    case "call":
      return n.args;
    case "if":
      return [n.c, n.a, n.b];
    case "lag":
      return [n.n];
    case "fitval":
      return [n.arg];
    case "index":
      return [n.i];
    case "agg":
      return n.range ?? [];
    default:
      return [];
  }
}

/** Column letters / `x` a tree reads, directly or through a row-aware form. */
export function columnsRead(n: Node, out: Set<string> = new Set()): Set<string> {
  if (n.k === "var") out.add(n.name);
  if (n.k === "lag" || n.k === "diff" || n.k === "agg" || n.k === "cumsum" || n.k === "index") out.add(n.col);
  if (n.k === "textcmp" && !n.textCol) out.add(n.ref);
  for (const c of children(n)) columnsRead(c, out);
  return out;
}

/** True when the tree reads no column, row, or fitted value — a constant. */
export function isConstant(n: Node): boolean {
  if (n.k === "var" || n.k === "row" || n.k === "lag" || n.k === "diff" || n.k === "agg" || n.k === "fit" || n.k === "fitval") return false;
  if (n.k === "cumsum" || n.k === "index" || n.k === "sheet" || n.k === "textcmp") return false;
  return children(n).every(isConstant);
}
