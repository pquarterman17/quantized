// The worksheet formula language's row-aware special forms (JMP_GAP J11):
// `if(cond, a, b)`, `row()`, `lag(A, k)`, `diff(A)`, and the aggregate
// references (`mean(A)`, `sd(A)`, `min(A)`, `max(A)`, `median(A)`, `sum(A)`,
// `count(A)`). Split out of formula.ts to keep the tokenizer/precedence-
// climbing parser module under the repo's line ceiling — these are all
// "given the already-eaten `name(`, consume the rest of the call" leaves,
// naturally separable from the arithmetic/logical grammar that calls them.
//
// See formula.ts's module header for the full NaN-propagation rules and the
// aggregate/row-scope decision (row()/lag()/diff()/aggregates all read the
// SAME rows the plain per-row scalar context does).
//
// row() numbering is 1-based, matching the worksheet grid's visible row
// numbers (GridRow.tsx renders `{r + 1}` for the 0-based original row index).

import { AGGREGATE_NAMES, computeAggregate, type AggregateName } from "./formulaAggregates";
import type { FormulaFn, Tok } from "./formulaTypes";

/** The subset of the parser's token-stream operations these special forms
 *  need — a small capability interface so this module never touches
 *  formula.ts's private tokenizer state directly. `parseExpr` is the
 *  caller's top-of-grammar parse function (parseOr in formula.ts today) so
 *  arguments here get the FULL grammar, e.g. `if(A > 0 and B < 5, x, 0)`. */
export interface ParserOps {
  peek(): Tok | undefined;
  peekAt(offset: number): Tok | undefined;
  eat(): Tok;
  expectOp(v: string): void;
  parseExpr(): FormulaFn;
  /** LIBRARY_WORKBOOK_UX_PLAN PR K (K1): report a bare-column-name reference
   *  as it's parsed (static, once per occurrence — not per row). formula.ts's
   *  `referencedColumns` and `compileFormula` share this exact call site so
   *  the two can never disagree about what a formula references. A no-op
   *  when the caller isn't collecting (ordinary compilation). */
  ref(name: string): void;
}

function parseBareColumnArg(fnName: string, ops: ParserOps, consts: Record<string, number>): string {
  const t = ops.peek();
  if (!t || t.t !== "name") throw new Error(`${fnName}() expects a bare column name`);
  if (t.v in consts) throw new Error(`${fnName}() expects a bare column name, not constant "${t.v}"`);
  const nxt = ops.peekAt(1);
  // A bare column name must be the WHOLE argument — the very next token has
  // to be its terminator (a "," before the next argument, or the closing
  // ")"), not the start of a function call or a further operator.
  const terminates = !!nxt && nxt.t === "op" && (nxt.v === "," || nxt.v === ")");
  if (!terminates) throw new Error(`${fnName}() expects a bare column name, not an expression`);
  ops.eat();
  ops.ref(t.v);
  return t.v;
}

/** Outcome of trying to parse `fname(` as one of this module's special
 *  forms, given the name + open-paren already consumed by the caller:
 *  - `{ fn }` — fully parsed; use it as the call's result.
 *  - `{ elementwiseFallback: true }` — `fname` was "min"/"max" but the call
 *    wasn't the bare-single-column aggregate shape; the caller should parse
 *    it as an ordinary (elementwise) function call instead. No tokens were
 *    consumed beyond the peeking needed to decide this.
 *  - `undefined` — `fname` isn't one of this module's special forms at all;
 *    the caller should parse it as an ordinary function call.
 */
export function tryParseRowAwareCall(
  fname: string,
  ops: ParserOps,
  consts: Record<string, number>,
): { fn: FormulaFn } | { elementwiseFallback: true } | undefined {
  if (fname === "if") {
    const cond = ops.parseExpr();
    ops.expectOp(",");
    const whenTrue = ops.parseExpr();
    ops.expectOp(",");
    const whenFalse = ops.parseExpr();
    ops.expectOp(")");
    const fn: FormulaFn = (c, ex) => {
      const cv = cond(c, ex);
      if (Number.isNaN(cv)) return NaN;
      return cv !== 0 ? whenTrue(c, ex) : whenFalse(c, ex);
    };
    return { fn };
  }
  if (fname === "row") {
    if (!(ops.peek()?.t === "op" && ops.peek()?.v === ")")) throw new Error("row() takes no arguments");
    ops.eat(); // ")"
    const fn: FormulaFn = (_c, ex) => {
      if (!ex) throw new Error("row() has no row context to evaluate against");
      return ex.row + 1; // 1-based — matches GridRow's visible row number
    };
    return { fn };
  }
  if (fname === "lag") {
    const col = parseBareColumnArg("lag", ops, consts);
    ops.expectOp(",");
    const kFn = ops.parseExpr();
    ops.expectOp(")");
    const fn: FormulaFn = (c, ex) => {
      if (!ex) throw new Error("lag() has no row context to evaluate against");
      const arr = ex.columns[col];
      if (!arr) throw new Error(`unknown variable "${col}"`);
      const k = Math.trunc(kFn(c, ex));
      const idx = ex.row - k;
      return idx >= 0 && idx < arr.length ? arr[idx] : NaN;
    };
    return { fn };
  }
  if (fname === "diff") {
    const col = parseBareColumnArg("diff", ops, consts);
    ops.expectOp(")");
    const fn: FormulaFn = (_c, ex) => {
      if (!ex) throw new Error("diff() has no row context to evaluate against");
      const arr = ex.columns[col];
      if (!arr) throw new Error(`unknown variable "${col}"`);
      const prev = ex.row - 1 >= 0 ? arr[ex.row - 1] : NaN;
      return arr[ex.row] - prev;
    };
    return { fn };
  }
  if (AGGREGATE_NAMES.has(fname)) {
    // Bare-single-column form (`mean(A)`, and `min(A)`/`max(A)` in aggregate
    // mode): a name token immediately followed by ")".
    const first = ops.peek();
    const second = ops.peekAt(1);
    const isBareSingle =
      !!first && first.t === "name" && !(first.v in consts) && !!second && second.t === "op" && second.v === ")";
    if (isBareSingle) {
      const col = (ops.eat() as Extract<Tok, { t: "name" }>).v;
      ops.ref(col);
      ops.expectOp(")");
      const aggName = fname as AggregateName;
      const fn: FormulaFn = (_c, ex) => {
        if (!ex) throw new Error(`${fname}() has no row context to evaluate against`);
        const arr = ex.columns[col];
        if (!arr) throw new Error(`unknown variable "${col}"`);
        return computeAggregate(aggName, arr);
      };
      return { fn };
    }
    if (fname === "min" || fname === "max") return { elementwiseFallback: true };
    throw new Error(`${fname}() expects a single bare column argument, e.g. ${fname}(A)`);
  }
  return undefined;
}
