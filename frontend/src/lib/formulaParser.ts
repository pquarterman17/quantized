// The worksheet formula PARSER (split out of lib/formula.ts, which keeps the
// column evaluation: no behaviour change). A safe arithmetic/logical evaluator for worksheet computed columns —
// a small recursive-descent parser, NOT eval/Function (satisfies the no-eval
// rule). It compiles an expression once into a closure evaluated per row
// against a scalar context of column values (`x`, `A`, `B`, `C`, …) plus an
// optional row-context (current row index + full column arrays), which the
// row-aware additions in lib/formulaRowFns.ts need.
//
// Grammar (precedence low -> high; JMP_GAP J11 v2 additions marked *NEW*):
//   or     := and ('or' and)*                        // *NEW*
//   and    := not ('and' not)*                        // *NEW*
//   not    := 'not' not | cmp                          // *NEW*, unary, right-assoc
//   cmp    := expr [('<'|'<='|'>'|'>='|'=='|'!=') expr]  // *NEW*, non-chaining
//   expr   := term (('+' | '-') term)*
//   term   := power (('*' | '/' | '//' | '%') power)*   // '//' P2.5
//   power  := unary ('^' power)?            // right-associative
//   unary  := ('-' | '+') unary | pypow
//   pypow  := atom ('**' unary)?            // P2.5, Python's rule
//   atom   := number | name ['(' args ')'] | '(' or ')'
//
// Worksheet audit #17: `c ? a : b` (= `if`; lowest precedence, right-assoc.),
// and col(), A[i], agg(A[i:j]), cumsum, sheet(), text == (lib/formulaRefs.ts).
//
// P2.5 (2026-09-27) Python-like syntax — tokenizer additions are documented
// in formulaTokenize.ts (`**`, `//`, `np.` prefixes, "text", `.member`);
// `where(c, a, b)` is `if`; fitted-value references `fit("Model", "p")` /
// `fit("Model").p` / `fitval("Model", x)` are formulaFitRefs.ts. Tokenizer
// errors end in "(column N)"; the ƒx bar adds it to parse errors too.
//
// A parenthesized group and every function argument parse the FULL `or`
// grammar (so `if(A > 0 and B < 5, sin(x), 0)` is legal), not just `expr` —
// the one behavioral widening beyond "new operators at the bottom of the
// table"; it does not change how any EXISTING (arithmetic-only) formula
// parses, since it's a strict superset there.
//
// Logical-operator style (a deliberate choice, not both): keyword `and` /
// `or` / `not`, lowercase, case-sensitive — NOT `&& || !`. `!` collides
// visually with `!=` in a one-character-lookahead tokenizer, and the
// keyword form reads better in a formula bar next to `sin`/`sqrt`/etc.
// `and`/`or`/`not` are keywords at their grammar position (infix for and/
// or, prefix for not) — a formula can't call them as functions (`and(1,2)`
// falls through to the plain FUNCS table, which doesn't define "and", so it
// fails with "unknown function"). `if`/`row`/`lag`/`diff` and the aggregate
// names ARE claimed as function names (calling them shadows nothing since
// nothing else defines them). None of this is a special "reserved word"
// rejection at the bare-variable level: `and` (or `mean`, etc) used WITHOUT
// parens just falls through to an ordinary variable lookup and fails with
// "unknown variable", same as any other undefined identifier — moot in
// practice since today's columns are always `x` or a channelLetter
// (uppercase), so no real collision is possible.
//
// Comparisons yield 1/0 (never boolean) so they compose with arithmetic
// (`(A > 0) * B`); logicals take/produce that same 1/0-or-NaN encoding.
//
// NaN-propagation rules (documented once, here):
//   - `<  <=  >  >=  ==  !=` : NaN if EITHER operand is NaN, else 1/0.
//   - `and` / `or`            : NaN if EITHER evaluated operand is NaN, else
//                                the boolean combination (1/0) — no short-
//                                circuiting a NaN away via the other operand.
//   - `not`                   : NaN if the operand is NaN, else 1/0.
//   - `if(cond, a, b)`        : NaN if `cond` is NaN (a/b are NOT evaluated
//                                in that case — the one place this evaluator
//                                short-circuits); otherwise picks `a`
//                                (cond != 0) or `b` (cond == 0), and that
//                                branch's own NaN-ness passes through as-is.
//   - `lag(A, k)` / `diff(A)` : NaN when the looked-back row is out of
//                                bounds, OR when the source value there is
//                                itself NaN (ordinary arithmetic propagation
//                                — `diff` is literally `A - lag(A, 1)`).
//   - `row()`                 : never NaN (always an in-range integer).
//   - aggregates (`mean` etc) : see formulaAggregates.ts's header — skip NaN
//                                entries ("omitnan"), NaN result only when
//                                zero finite values remain (count() returns
//                                0 instead — "how many" is well-defined even
//                                for none).
//
// Aggregate / row-scope (J11 #3 — resolved, not assumed): applyFormulas /
// recomputeWithErrors receive whatever DataStruct the CALLER hands them, and
// today that is the dataset's FULL raw row set — store/useApp.ts's
// `recompute` and `addFormula` call `applyFormulas`/`recomputeWithErrors` on
// `d.data` directly, NOT through lib/rowstate's `analysisData(ds)` (the
// exclusion(#50)/filter(#53)-pruned "analysis view"). So the existing plain
// per-row scalar context (`ctx.A`, `ctx.x`, …) already includes excluded
// and filter-dropped rows today — and this evaluator has no way to see
// otherwise: it takes a DataStruct, never a Dataset, so it can't read
// `excludedRows`/the filter itself (architecture.test.ts's row-state guard
// enforces that boundary —
// only lib/rowstate + a couple of store slices may touch that field). To
// stay CONSISTENT with the scalar context every existing formula already
// reads, row()/lag()/diff()/the aggregates are computed over that exact same
// row set: `base.time.length` rows, original-row order, snapshotted once per
// formula just before its column is appended. If a future item wires
// formula application through `analysisData()`, aggregates automatically
// follow (they read the same columns the row evaluator does) — no change
// needed here.
//
// min/max disambiguation: `min`/`max` keep their original 2-(or-more-)
// argument ELEMENTWISE meaning (`max(A, B)` -> per-row Math.max) UNLESS
// called with exactly ONE argument that is a bare column reference
// (`max(A)`), which means the aggregate over that column. `max(2*A)` (a
// single but non-bare argument) still means the old elementwise
// `Math.max(2*A)` = that one value. Every other aggregate name (mean/sd/
// median/sum/count) has no elementwise form and always requires a single
// bare column argument.

import { tryParseFitRef } from "./formulaFitRefs";
import { formulaExtension, requireExtension } from "./formulaExt";
import { CONSTS, FUNCS } from "./formulaFuncs";
import { tryParseRowAwareCall, type ParserOps } from "./formulaRowFns";
import { tokenize } from "./formulaTokenize";
import { applyAnd, applyCompare, applyNot, applyOr, COMPARE_OPS, type FormulaFn, type Tok } from "./formulaTypes";

export { tokenize };

/** Compile an expression to a per-row evaluator. Throws on a parse error.
 *  `onRef`, when given, is called once (at PARSE time, not per row/eval) for
 *  every bare column-letter/variable reference, with its token index in
 *  `tokenize(src)` — the single collection point `referencedColumns` below
 *  (and `lib/formulaRename.ts`'s column-shift rewrite) reuses so none can
 *  ever disagree (LIBRARY_WORKBOOK_UX_PLAN PR K, K1). Ordinary callers pass
 *  nothing and pay no cost beyond one no-op call per reference. `onNonLocal`
 *  is the same idea for a non-row-local special form (formulaRowFns.ts's ParserOps.nonLocal; lib/formulaIncremental.ts's one caller). */
export function compileFormula(src: string, onRef?: (name: string, tokenIndex: number) => void, onNonLocal?: (kind: "lag" | "diff" | "aggregate") => void): FormulaFn {
  const toks = tokenize(src);
  // A formula that makes a complex value (complex(), polar(), `2i`) builds every operator through the lazy module (C9).
  const cxm = toks.some((t) => t.v === "complex" || t.v === "polar") ? requireExtension().complex : undefined;
  let pos = 0;
  const peek = (): Tok | undefined => toks[pos];
  const peekAt = (offset: number): Tok | undefined => toks[pos + offset];
  const eat = (): Tok => toks[pos++];
  const expectOp = (v: string): void => {
    const t = eat();
    if (!t || t.t !== "op" || t.v !== v) throw new Error(`expected "${v}"`);
  };
  const isKeyword = (t: Tok | undefined, kw: string): boolean => !!t && t.t === "name" && t.v === kw;
  // Names bound by an enclosing `let(…)` (lib/formulaLet.ts), innermost last. A
  // bound name is a scalar of the evaluation context, never a column reference.
  const scope: string[] = [];
  const ref = (name: string): void => {
    // A bare-column argument (lag(t, 1), mean(t)) names a column, not a scalar.
    if (scope.includes(name)) throw new Error(`"${name}" is bound by let(), so it is a number here, not a column`);
    onRef?.(name, pos - 1); // pos-1: ref() always fires right after eat()
  };

  // `c ? a : b` (audit #17): `if(c, a, b)`, NaN when c is NaN — parsed by
  // the lazy lib/formulaRefs.ts (`parseConditional`).
  function parseTernary(): FormulaFn {
    const cond = parseOr();
    return peek()?.t === "op" && peek()?.v === "?" ? requireExtension().parseConditional(cxm ? cxm.op("?", [cond]) : cond, rowFnOps) : cond;
  }
  const logic = (kw: "or" | "and", next: () => FormulaFn, apply: (a: number, b: number) => number) => (): FormulaFn => {
    let left = next();
    while (isKeyword(peek(), kw)) {
      eat();
      const right = next();
      const l = left;
      left = cxm ? cxm.op(kw, [l, right]) : (c, ex) => apply(l(c, ex), right(c, ex));
    }
    return left;
  };
  const parseAnd = logic("and", () => parseNot(), applyAnd);
  const parseOr = logic("or", parseAnd, applyOr);
  function parseNot(): FormulaFn {
    if (isKeyword(peek(), "not")) {
      eat();
      const operand = parseNot(); // unary, right-recursive ("not not A")
      return cxm ? cxm.op("not", [operand]) : (c, ex) => applyNot(operand(c, ex));
    }
    return parseComparison();
  }
  function parseComparison(): FormulaFn {
    const text = formulaExtension()?.tryParseTextCompare(rowFnOps); // `A == "label"` (audit #17)
    if (text) return text;
    const left = parseArith();
    const t = peek();
    if (t && t.t === "op" && COMPARE_OPS.has(t.v)) {
      eat();
      const op = t.v;
      const right = parseArith();
      return cxm ? cxm.op(op, [left, right]) : (c, ex) => applyCompare(op, left(c, ex), right(c, ex));
    }
    return left;
  }
  function parseArith(): FormulaFn {
    let left = parseTerm();
    for (let t = peek(); t && t.t === "op" && (t.v === "+" || t.v === "-"); t = peek()) {
      eat();
      const right = parseTerm();
      const op = t.v;
      const l = left;
      left = cxm ? cxm.op(op, [l, right]) : (c, ex) => (op === "+" ? l(c, ex) + right(c, ex) : l(c, ex) - right(c, ex));
    }
    return left;
  }
  function parseTerm(): FormulaFn {
    let left = parsePower();
    for (let t = peek(); t && t.t === "op" && ["*", "/", "%", "//"].includes(t.v); t = peek()) {
      eat();
      const right = parsePower();
      const op = t.v;
      const l = left;
      // `//` is Python floor division; `%` keeps its JS meaning (the sign of
      // the dividend), which differs from Python for negative operands.
      left = cxm ? cxm.op(op, [l, right]) : (c, ex) =>
        op === "*" ? l(c, ex) * right(c, ex) : op === "/" ? l(c, ex) / right(c, ex) : op === "//" ? Math.floor(l(c, ex) / right(c, ex)) : l(c, ex) % right(c, ex);
    }
    return left;
  }
  const power = (base: FormulaFn, exp: FormulaFn): FormulaFn => (cxm ? cxm.op("^", [base, exp]) : (c, ex) => base(c, ex) ** exp(c, ex));
  function parsePower(): FormulaFn {
    const base = parseUnary();
    const t = peek();
    if (t && t.t === "op" && t.v === "^") {
      eat();
      const exp = parsePower(); // right-assoc
      return power(base, exp);
    }
    return base;
  }
  function parseUnary(): FormulaFn {
    const t = peek();
    if (t && t.t === "op" && (t.v === "-" || t.v === "+")) {
      eat();
      const operand = parseUnary();
      return t.v === "-" ? (cxm ? cxm.op("neg", [operand]) : (c, ex) => -operand(c, ex)) : operand;
    }
    return parsePyPow();
  }
  // Python `**` (P2.5): binds tighter than a unary sign on its left and looser
  // on its right — `-A**2` is -(A**2), `2**-1` is 0.5, right-associative —
  // the same rule as the P2.7 fit equations. `^` keeps its original, looser
  // place above (`-A^2` is (-A)^2), so no existing formula changes meaning.
  function parsePyPow(): FormulaFn {
    const base = parseAtom();
    const t = peek();
    if (t && t.t === "op" && t.v === "**") {
      eat();
      return power(base, parseUnary());
    }
    return base;
  }

  // Bridges this closure's private token-stream ops to formulaRowFns.ts's
  // ParserOps capability interface, so the row-aware special forms (if /
  // row / lag / diff / the aggregates) parse against this SAME token stream.
  const opsFor = (name: string): ParserOps => (cxm ? cxm.ops(rowFnOps, name) : rowFnOps);
  const rowFnOps: ParserOps = { peek, peekAt, eat, expectOp, parseExpr: () => parseTernary(), ref, bind: (name) => (scope.push(name), () => scope.pop()), nonLocal: onNonLocal ?? (() => {}) };

  function parseAtom(): FormulaFn {
    const t = eat();
    if (!t) throw new Error("unexpected end of expression");
    if (t.t === "num") return () => t.v;
    if (t.t === "op" && t.v === "(") {
      const e = parseTernary();
      expectOp(")");
      return e;
    }
    if (t.t === "name") {
      const nxt = peek();
      if (nxt && nxt.t === "op" && nxt.v === "(") {
        eat(); // consume "("
        return parseCall(t.v);
      }
      const name = t.v;
      if (!scope.includes(name)) {
        if (Object.hasOwn(CONSTS, name)) {
          const k = CONSTS[name];
          return () => k;
        }
        ref(name);
      }
      if (!scope.includes(name) && peek()?.t === "op" && peek()?.v === "[") return requireExtension().parseIndexSuffix(name, opsFor("A[i]")); // A[i]
      return (c) => {
        const v = c[name];
        if (v === undefined) throw new Error(`unknown variable "${name}"`);
        return v;
      };
    }
    throw new Error(`unexpected token "${t.v}"`);
  }

  /** Parse a function call's arguments/close-paren, given the already-eaten
   *  name and open-paren: try the row-aware special forms first, then fall
   *  back to the plain FUNCS table. */
  function parseArgs(): FormulaFn[] {
    const args: FormulaFn[] = [];
    if (!(peek()?.t === "op" && peek()?.v === ")")) {
      args.push(parseTernary());
      while (peek()?.t === "op" && peek()?.v === ",") {
        eat();
        args.push(parseTernary());
      }
    }
    expectOp(")");
    return args;
  }
  function parseCall(fname: string): FormulaFn {
    if (cxm?.own.has(fname)) return cxm.op(fname, parseArgs());
    const ops = opsFor(fname);
    const ext = formulaExtension()?.tryParseCall(fname, ops, CONSTS); // cumsum, sheet, col, agg(A[i:j]) — audit #17
    if (ext) return ext;
    const special = tryParseRowAwareCall(fname, ops, CONSTS) ?? tryParseFitRef(fname, ops, compileFormula);
    if (special && "fn" in special) return special.fn;

    const x = formulaExtension(); // own keys only: never an inherited `constructor`
    const fn = Object.hasOwn(FUNCS, fname) ? FUNCS[fname] : x && Object.hasOwn(x.funcs, fname) ? x.funcs[fname] : undefined;
    if (!fn) throw new Error(`unknown function "${fname}"`); // before lib/formulaRefs loads: cumsum/sheet/col/row* too (recomputed on load)
    const args = parseArgs();
    return cxm ? cxm.op(fname, args, fn) : (c, ex) => fn(...args.map((a) => a(c, ex)));
  }

  // Parse errors here are unpositioned (bytes: this is eager); the authoring
  // path adds the column from the lazy tree parser (lib/derivedColumn.ts).
  const fn = parseTernary();
  if (pos !== toks.length) throw new Error("trailing characters in expression");
  return cxm ? cxm.op("=", [fn]) : fn;
}

/** Static pass over the SAME grammar `compileFormula` parses (K1): every
 *  column-letter/variable this expression references, in first-seen order,
 *  plus whether it parses at all. Reuses `compileFormula`'s own `onRef`
 *  collection hook rather than a second parser — by construction, the letters
 *  reported here are exactly the names `compileFormula`'s returned evaluator
 *  looks up in its per-row context (`ctx[name]` / `ex.columns[name]`), for
 *  row-aware functions (lag/diff/aggregates) included, since those parse
 *  their bare-column argument through the very same `ref()` call
 *  (`formulaRowFns.ts`'s `parseBareColumnArg` / aggregate bare-single branch).
 *  `valid: false` (empty letters) means the expression doesn't compile at all
 *  (syntax error, unknown function, …) — it says nothing about whether every
 *  reported letter resolves to a REAL column in a given dataset; that's the
 *  caller's job (a formula may name a column that doesn't exist yet, or no
 *  longer does after a reimport — not a parse error). */
export function referencedColumns(expr: string): { letters: string[]; valid: boolean } {
  const letters: string[] = [];
  const seen = new Set<string>();
  try {
    compileFormula(expr, (name) => {
      if (!seen.has(name)) {
        seen.add(name);
        letters.push(name);
      }
    });
    return { letters, valid: true };
  } catch {
    return { letters: [], valid: false };
  }
}
