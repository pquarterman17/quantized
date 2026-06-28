// Safe arithmetic formula evaluator for worksheet computed columns — a small
// recursive-descent parser, NOT eval/Function (satisfies the no-eval rule). It
// compiles an expression once into a closure evaluated per row against a context
// of column values: `x` (the x-axis) and `A`, `B`, `C`, … (value channels).
//
// Grammar (precedence low→high):
//   expr  := term (('+' | '-') term)*
//   term  := power (('*' | '/' | '%') power)*
//   power := unary ('^' power)?            // right-associative
//   unary := ('-' | '+') unary | atom
//   atom  := number | name ['(' args ')'] | '(' expr ')'

import type { ComputedColumn, DataStruct } from "./types";

export type FormulaFn = (ctx: Record<string, number>) => number;

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

type Tok = { t: "num"; v: number } | { t: "name"; v: string } | { t: "op"; v: string };

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
    } else if ("+-*/%^(),".includes(c)) {
      toks.push({ t: "op", v: c });
      i++;
    } else {
      throw new Error(`unexpected character "${c}"`);
    }
  }
  return toks;
}

/** Compile an expression to a per-row evaluator. Throws on a parse error. */
export function compileFormula(src: string): FormulaFn {
  const toks = tokenize(src);
  let pos = 0;
  const peek = (): Tok | undefined => toks[pos];
  const eat = (): Tok => toks[pos++];
  const expectOp = (v: string): void => {
    const t = eat();
    if (!t || t.t !== "op" || t.v !== v) throw new Error(`expected "${v}"`);
  };

  function parseExpr(): FormulaFn {
    let left = parseTerm();
    for (let t = peek(); t && t.t === "op" && (t.v === "+" || t.v === "-"); t = peek()) {
      eat();
      const right = parseTerm();
      const op = t.v;
      const l = left;
      left = (c) => (op === "+" ? l(c) + right(c) : l(c) - right(c));
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
      left = (c) => (op === "*" ? l(c) * right(c) : op === "/" ? l(c) / right(c) : l(c) % right(c));
    }
    return left;
  }
  function parsePower(): FormulaFn {
    const base = parseUnary();
    const t = peek();
    if (t && t.t === "op" && t.v === "^") {
      eat();
      const exp = parsePower(); // right-assoc
      return (c) => base(c) ** exp(c);
    }
    return base;
  }
  function parseUnary(): FormulaFn {
    const t = peek();
    if (t && t.t === "op" && (t.v === "-" || t.v === "+")) {
      eat();
      const operand = parseUnary();
      return t.v === "-" ? (c) => -operand(c) : operand;
    }
    return parseAtom();
  }
  function parseAtom(): FormulaFn {
    const t = eat();
    if (!t) throw new Error("unexpected end of expression");
    if (t.t === "num") return () => t.v;
    if (t.t === "op" && t.v === "(") {
      const e = parseExpr();
      expectOp(")");
      return e;
    }
    if (t.t === "name") {
      const nxt = peek();
      if (nxt && nxt.t === "op" && nxt.v === "(") {
        eat();
        const fn = FUNCS[t.v];
        if (!fn) throw new Error(`unknown function "${t.v}"`);
        const args: FormulaFn[] = [];
        if (!(peek()?.t === "op" && peek()?.v === ")")) {
          args.push(parseExpr());
          while (peek()?.t === "op" && peek()?.v === ",") {
            eat();
            args.push(parseExpr());
          }
        }
        expectOp(")");
        return (c) => fn(...args.map((a) => a(c)));
      }
      if (t.v in CONSTS) {
        const k = CONSTS[t.v];
        return () => k;
      }
      const name = t.v;
      return (c) => {
        const v = c[name];
        if (v === undefined) throw new Error(`unknown variable "${name}"`);
        return v;
      };
    }
    throw new Error(`unexpected token "${t.v}"`);
  }

  const fn = parseExpr();
  if (pos !== toks.length) throw new Error("trailing characters in expression");
  return fn;
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

/** Append computed columns to a base DataStruct, evaluating each formula in order
 *  over `x` + the accumulating channels (so a later formula may reference an
 *  earlier computed column). A formula that fails to compile or evaluate yields
 *  an all-NaN column, keeping the column count stable so downstream channel
 *  indices never shift. */
export function applyFormulas(base: DataStruct, formulas: ComputedColumn[]): DataStruct {
  if (!formulas.length) return base;
  const labels = [...base.labels];
  const units = [...base.units];
  const values = base.values.map((row) => [...row]);
  for (const f of formulas) {
    let fn: FormulaFn | null;
    try {
      fn = compileFormula(f.expr);
    } catch {
      fn = null;
    }
    for (let r = 0; r < base.time.length; r++) {
      let v = Number.NaN;
      if (fn) {
        const ctx: Record<string, number> = { x: base.time[r] };
        labels.forEach((_, c) => {
          ctx[channelLetter(c)] = values[r]?.[c];
        });
        try {
          v = fn(ctx);
        } catch {
          v = Number.NaN;
        }
      }
      values[r].push(v);
    }
    labels.push(f.name);
    units.push(f.unit ?? "");
  }
  return { ...base, labels, units, values };
}

/** Recompute a dataset's computed columns from its current base: strip the last
 *  `formulas.length` columns (the stale computed ones) and reapply the formulas. */
export function recomputeData(data: DataStruct, formulas: ComputedColumn[]): DataStruct {
  return applyFormulas(baseColumns(data, formulas.length), formulas);
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
