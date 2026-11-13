// The worksheet formula language's plain function table + named constants,
// split out of formula.ts (at its line ceiling) so lib/derivedExprAst.ts — the
// lazy AST parser behind P2.5 units / error propagation — accepts exactly the
// same names the evaluator does.

// P2.5 Python-like additions: numpy's arc* spellings,
// the inverse/hyperbolic set the P2.7 fit equations already accept, atan2 and
// hypot. `round` is deliberately absent: JS, numpy and MATLAB disagree on
// halves, so no spelling here could be unsurprising to all three.
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
  floor: Math.floor,
  ceil: Math.ceil,
  hypot: Math.hypot,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
};
export const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };
