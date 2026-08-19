// Safe arithmetic/logical formula evaluator for worksheet computed columns —
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
//   term   := power (('*' | '/' | '%') power)*
//   power  := unary ('^' power)?            // right-associative
//   unary  := ('-' | '+') unary | atom
//   atom   := number | name ['(' args ')'] | '(' or ')'
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
// recomputeData receive whatever DataStruct the CALLER hands them, and today
// that is the dataset's FULL raw row set — store/useApp.ts's `recompute` and
// `addFormula` call `applyFormulas`/`recomputeData` on `d.data` directly, NOT
// through lib/rowstate's `analysisData(ds)` (the exclusion(#50)/filter(#53)
// -pruned "analysis view"). So the existing plain per-row scalar context
// (`ctx.A`, `ctx.x`, …) already includes excluded and filter-dropped rows
// today — and this evaluator has no way to see otherwise: it takes a
// DataStruct, never a Dataset, so it can't read `excludedRows`/the filter
// itself (architecture.test.ts's row-state guard enforces that boundary —
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

import { tryParseRowAwareCall, type ParserOps } from "./formulaRowFns";
import { applyAnd, applyCompare, applyNot, applyOr, COMPARE_OPS, type FormulaFn, type Tok } from "./formulaTypes";
import { computeRecodeAppend } from "./recode";
import type { ComputedColumn, DataStruct } from "./types";

export type { FormulaFn, FormulaRowContext } from "./formulaTypes";
export { computeAggregate, AGGREGATE_NAMES, type AggregateName } from "./formulaAggregates";

const FUNCS: Record<string, (...a: number[]) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  exp: Math.exp,
  log: Math.log,
  ln: Math.log,
  log10: Math.log10,
  sqrt: Math.sqrt,
  abs: Math.abs,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t") {
      i++;
    } else if ((c >= "0" && c <= "9") || c === ".") {
      let j = i + 1;
      while (j < src.length && /[0-9.eE+-]/.test(src[j])) {
        // allow exponent sign only right after e/E
        if ((src[j] === "+" || src[j] === "-") && !/[eE]/.test(src[j - 1])) break;
        j++;
      }
      const num = Number(src.slice(i, j));
      if (!Number.isFinite(num)) throw new Error(`bad number "${src.slice(i, j)}"`);
      toks.push({ t: "num", v: num });
      i = j;
    } else if (/[a-zA-Z_]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[a-zA-Z0-9_]/.test(src[j])) j++;
      toks.push({ t: "name", v: src.slice(i, j) });
      i = j;
    } else if (c === "<" || c === ">" || c === "=" || c === "!") {
      // Comparison operators: <= >= == != are two-char; < and > also stand
      // alone. A lone "=" or "!" is not a valid token (no assignment, and
      // "not" — not "!" — is the logical-negation spelling; see header).
      if (src[i + 1] === "=") {
        toks.push({ t: "op", v: c + "=" });
        i += 2;
      } else if (c === "<" || c === ">") {
        toks.push({ t: "op", v: c });
        i++;
      } else {
        throw new Error(`unexpected character "${c}"`);
      }
    } else if ("+-*/%^(),".includes(c)) {
      toks.push({ t: "op", v: c });
      i++;
    } else {
      throw new Error(`unexpected character "${c}"`);
    }
  }
  return toks;
}

/** Compile an expression to a per-row evaluator. Throws on a parse error.
 *  `onRef`, when given, is called once (at PARSE time, not per row/eval) for
 *  every bare column-letter/variable reference the expression contains — the
 *  single collection point `referencedColumns` below reuses so the two can
 *  never disagree (LIBRARY_WORKBOOK_UX_PLAN PR K, K1). Ordinary callers pass
 *  nothing and pay no cost beyond one extra no-op call per reference. */
export function compileFormula(src: string, onRef?: (name: string) => void): FormulaFn {
  const toks = tokenize(src);
  let pos = 0;
  const peek = (): Tok | undefined => toks[pos];
  const peekAt = (offset: number): Tok | undefined => toks[pos + offset];
  const eat = (): Tok => toks[pos++];
  const expectOp = (v: string): void => {
    const t = eat();
    if (!t || t.t !== "op" || t.v !== v) throw new Error(`expected "${v}"`);
  };
  const isKeyword = (t: Tok | undefined, kw: string): boolean => !!t && t.t === "name" && t.v === kw;
  const ref = onRef ?? ((): void => {});

  function parseOr(): FormulaFn {
    let left = parseAnd();
    while (isKeyword(peek(), "or")) {
      eat();
      const right = parseAnd();
      const l = left;
      left = (c, ex) => applyOr(l(c, ex), right(c, ex));
    }
    return left;
  }
  function parseAnd(): FormulaFn {
    let left = parseNot();
    while (isKeyword(peek(), "and")) {
      eat();
      const right = parseNot();
      const l = left;
      left = (c, ex) => applyAnd(l(c, ex), right(c, ex));
    }
    return left;
  }
  function parseNot(): FormulaFn {
    if (isKeyword(peek(), "not")) {
      eat();
      const operand = parseNot(); // unary, right-recursive ("not not A")
      return (c, ex) => applyNot(operand(c, ex));
    }
    return parseComparison();
  }
  function parseComparison(): FormulaFn {
    const left = parseArith();
    const t = peek();
    if (t && t.t === "op" && COMPARE_OPS.has(t.v)) {
      eat();
      const op = t.v;
      const right = parseArith();
      return (c, ex) => applyCompare(op, left(c, ex), right(c, ex));
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
      left = (c, ex) => (op === "+" ? l(c, ex) + right(c, ex) : l(c, ex) - right(c, ex));
    }
    return left;
  }
  function parseTerm(): FormulaFn {
    let left = parsePower();
    for (let t = peek(); t && t.t === "op" && "*/%".includes(t.v); t = peek()) {
      eat();
      const right = parsePower();
      const op = t.v;
      const l = left;
      left = (c, ex) =>
        op === "*" ? l(c, ex) * right(c, ex) : op === "/" ? l(c, ex) / right(c, ex) : l(c, ex) % right(c, ex);
    }
    return left;
  }
  function parsePower(): FormulaFn {
    const base = parseUnary();
    const t = peek();
    if (t && t.t === "op" && t.v === "^") {
      eat();
      const exp = parsePower(); // right-assoc
      return (c, ex) => base(c, ex) ** exp(c, ex);
    }
    return base;
  }
  function parseUnary(): FormulaFn {
    const t = peek();
    if (t && t.t === "op" && (t.v === "-" || t.v === "+")) {
      eat();
      const operand = parseUnary();
      return t.v === "-" ? (c, ex) => -operand(c, ex) : operand;
    }
    return parseAtom();
  }

  // Bridges this closure's private token-stream ops to formulaRowFns.ts's
  // ParserOps capability interface, so the row-aware special forms (if /
  // row / lag / diff / the aggregates) parse against this SAME token stream
  // without formulaRowFns.ts touching `toks`/`pos` directly.
  const rowFnOps: ParserOps = { peek, peekAt, eat, expectOp, parseExpr: () => parseOr(), ref };

  function parseAtom(): FormulaFn {
    const t = eat();
    if (!t) throw new Error("unexpected end of expression");
    if (t.t === "num") return () => t.v;
    if (t.t === "op" && t.v === "(") {
      const e = parseOr();
      expectOp(")");
      return e;
    }
    if (t.t === "name") {
      const nxt = peek();
      if (nxt && nxt.t === "op" && nxt.v === "(") {
        eat(); // consume "("
        return parseCall(t.v);
      }
      if (t.v in CONSTS) {
        const k = CONSTS[t.v];
        return () => k;
      }
      const name = t.v;
      ref(name);
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
  function parseCall(fname: string): FormulaFn {
    const special = tryParseRowAwareCall(fname, rowFnOps, CONSTS);
    if (special && "fn" in special) return special.fn;

    const fn = FUNCS[fname];
    if (!fn) throw new Error(`unknown function "${fname}"`);
    const args: FormulaFn[] = [];
    if (!(peek()?.t === "op" && peek()?.v === ")")) {
      args.push(parseOr());
      while (peek()?.t === "op" && peek()?.v === ",") {
        eat();
        args.push(parseOr());
      }
    }
    expectOp(")");
    return (c, ex) => fn(...args.map((a) => a(c, ex)));
  }

  const fn = parseOr();
  if (pos !== toks.length) throw new Error("trailing characters in expression");
  return fn;
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

/** Strip the last `n` columns (the computed ones) from a DataStruct, returning
 *  the base. `n <= 0` returns the input unchanged. */
export function baseColumns(data: DataStruct, n: number): DataStruct {
  if (n <= 0) return data;
  const keep = Math.max(0, data.labels.length - n);
  return {
    ...data,
    labels: data.labels.slice(0, keep),
    units: data.units.slice(0, keep),
    values: data.values.map((row) => row.slice(0, keep)),
  };
}

/** The shared computation `applyFormulas`/`formulaErrors` both delegate to
 *  (K5b): ONE pass over the formula list, producing the resulting DataStruct
 *  AND the per-column error state side by side, so the two views can never
 *  drift apart. A formula that fails to compile OR whose evaluator throws on
 *  ANY row is recorded in `errors` (keyed by `ComputedColumn.name`, first
 *  failure's message) — but STILL yields its all-NaN column in `data.values`,
 *  keeping the column count stable so downstream channel indices never
 *  shift (unchanged pre-K5 behavior; the error state is a purely additive
 *  companion). Row-aware functions (row/lag/diff/aggregates) see the SAME
 *  rows as the plain scalar context — see the module header's "Aggregate /
 *  row-scope" note for what that means today. */
function computeFormulas(
  base: DataStruct,
  formulas: ComputedColumn[],
): { data: DataStruct; errors: Record<string, string> } {
  if (!formulas.length) return { data: base, errors: {} };
  const labels = [...base.labels];
  const units = [...base.units];
  const values = base.values.map((row) => [...row]);
  const rowCount = base.time.length;
  const errors: Record<string, string> = {};
  // J2: seeded from the base's own categorical channels so a recode can
  // resolve its source's level table, and grown as each recode column is
  // appended (see computeRecodeColumn) so a LATER column may recode an
  // earlier recode column too.
  const catLevels: Record<number, string[]> = base.cat_levels ? { ...base.cat_levels } : {};
  for (const f of formulas) {
    let colValues: number[];
    if (f.recode) {
      // J2: `catLevels` already holds every earlier column's table (base +
      // any prior recode), so a recode may itself recode an earlier recode
      // column — chaining through for free.
      const sourceIdx = labels.findIndex((_, c) => channelLetter(c) === f.recode!.sourceLetter);
      const result = computeRecodeAppend(
        f.recode,
        sourceIdx >= 0 ? catLevels[sourceIdx] : undefined,
        values.map((row) => row[sourceIdx]),
        rowCount,
      );
      colValues = result.codes;
      if (result.levels) catLevels[labels.length] = result.levels; // the column this recode is about to occupy
      if (result.error) errors[f.name] = result.error;
    } else {
      let fn: FormulaFn | null;
      try {
        fn = compileFormula(f.expr);
      } catch (e) {
        fn = null;
        errors[f.name] = e instanceof Error ? e.message : "formula failed to compile";
      }
      // One column-array snapshot per formula (not per row): captures `x` plus
      // every channel as of just before THIS formula's own column is appended
      // — exactly what the per-row scalar ctx below also reflects.
      const colSnapshot: Record<string, number[]> = { x: base.time };
      labels.forEach((_, c) => {
        colSnapshot[channelLetter(c)] = values.map((row) => row[c]);
      });
      colValues = [];
      for (let r = 0; r < rowCount; r++) {
        let v = Number.NaN;
        if (fn) {
          const ctx: Record<string, number> = { x: base.time[r] };
          labels.forEach((_, c) => {
            ctx[channelLetter(c)] = values[r]?.[c];
          });
          try {
            v = fn(ctx, { row: r, rowCount, columns: colSnapshot });
          } catch (e) {
            v = Number.NaN;
            // First failing row wins (later rows' errors are usually the same
            // root cause repeated); don't overwrite a compile-time error above.
            if (!errors[f.name]) errors[f.name] = e instanceof Error ? e.message : "formula evaluation failed";
          }
        }
        colValues.push(v);
      }
    }
    for (let r = 0; r < rowCount; r++) values[r].push(colValues[r]);
    labels.push(f.name);
    units.push(f.unit ?? "");
  }
  return {
    data: { ...base, labels, units, values, ...(Object.keys(catLevels).length ? { cat_levels: catLevels } : {}) },
    errors,
  };
}

/** Append computed columns to a base DataStruct, evaluating each formula in
 *  order over `x` + the accumulating channels (so a later formula may
 *  reference an earlier computed column). See `computeFormulas` for the
 *  per-column-failure behavior; this wrapper keeps the pre-K5 signature
 *  (data only) for every existing caller. */
export function applyFormulas(base: DataStruct, formulas: ComputedColumn[]): DataStruct {
  return computeFormulas(base, formulas).data;
}

/** The per-column error state (K5b) `applyFormulas` computes but discards —
 *  same single pass, errors only. */
export function formulaErrors(base: DataStruct, formulas: ComputedColumn[]): Record<string, string> {
  return computeFormulas(base, formulas).errors;
}

/** Recompute a dataset's computed columns from its current base: strip the last
 *  `formulas.length` columns (the stale computed ones) and reapply the formulas. */
export function recomputeData(data: DataStruct, formulas: ComputedColumn[]): DataStruct {
  return computeFormulas(baseColumns(data, formulas.length), formulas).data;
}

/** `recomputeData` plus its per-column error state (K5b), in the one pass —
 *  the chokepoint `store/useApp.ts`'s `recompute` helper uses so every base-
 *  data-changing action (corrections apply/reset, cell edits, reimport)
 *  keeps `Dataset.formulaErrors` in sync for free. */
export function recomputeWithErrors(
  data: DataStruct,
  formulas: ComputedColumn[],
): { data: DataStruct; errors: Record<string, string> } {
  return computeFormulas(baseColumns(data, formulas.length), formulas);
}

/** Channel letter for a 0-based index: 0→A, 1→B, … 25→Z, then AA, AB, … */
export function channelLetter(i: number): string {
  let n = i;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}
