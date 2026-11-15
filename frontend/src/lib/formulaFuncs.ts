// The worksheet formula language's plain function table + named constants,
// split out of formula.ts (at its line ceiling) so lib/derivedExprAst.ts — the
// lazy AST parser behind P2.5 units / error propagation — accepts exactly the
// same names the evaluator does.

// P2.5 Python-like additions: numpy's arc* spellings,
// the inverse/hyperbolic set the P2.7 fit equations already accept, atan2 and
// hypot. `round` (numpy's: halves to even) is in the lazy lib/formulaMath.ts.
// floor/ceil take an optional digits argument (gap audit 4, G3): floor(v, 2)
// is numpy.floor(v * 100) / 100; a negative n divides, as numpy.round does.

/** `op` at `n` decimal digits (numpy.round's scaling); without `n`, just `op`. */
export const atDigits =
  (op: (y: number) => number, fname: string) =>
  (v: number, n?: number): number => {
    if (n === undefined) return op(v);
    if (!Number.isInteger(n)) throw new Error(`${fname}(): the number of digits must be a whole number, not ${n}`);
    return n >= 0 ? op(v * 10 ** n) / 10 ** n : op(v / 10 ** -n) * 10 ** -n;
  };

export const FUNCS: Record<string, (...a: number[]) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  arcsin: Math.asin,
  arccos: Math.acos,
  arctan: Math.atan,
  atan2: Math.atan2,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  exp: Math.exp,
  log: Math.log,
  ln: Math.log,
  log10: Math.log10,
  log2: Math.log2,
  sqrt: Math.sqrt,
  abs: Math.abs,
  sign: Math.sign,
  floor: atDigits(Math.floor, "floor"),
  ceil: atDigits(Math.ceil, "ceil"),
  hypot: Math.hypot,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
};
// `nan` (numpy's np.nan): a blank cell, e.g. where Set Column Values leaves the
// rows outside its row range (if(row() >= 3 and row() <= 9, A, nan)).
export const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E, nan: Number.NaN };
