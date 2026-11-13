// The worksheet formula language's plain function table + named constants,
// split out of formula.ts (at its line ceiling) so lib/derivedExprAst.ts — the
// lazy AST parser behind P2.5 units / error propagation — accepts exactly the
// same names the evaluator does.

/** The finite arguments of a row function (worksheet audit #19). */
const finiteOf = (a: number[]): number[] => a.filter((v) => Number.isFinite(v));
const sumOf = (a: number[]): number => a.reduce((s, v) => s + v, 0);
/** Row statistics ACROSS columns (Origin's Row Statistics): `rowmean(A, B, C)`
 *  per row. Blank (NaN) cells are skipped; with none left the result is NaN
 *  (`rown` is then 0). `rowsd` is the sample SD (n − 1), NaN below 2 values. */
const ROW_FUNCS: Record<string, (...a: number[]) => number> = {
  rowmean: (...a) => ((f) => (f.length ? sumOf(f) / f.length : NaN))(finiteOf(a)),
  rowsd: (...a) => {
    const f = finiteOf(a);
    if (f.length < 2) return NaN;
    const m = sumOf(f) / f.length;
    return Math.sqrt(sumOf(f.map((v) => (v - m) ** 2)) / (f.length - 1));
  },
  rowmin: (...a) => ((f) => (f.length ? Math.min(...f) : NaN))(finiteOf(a)),
  rowmax: (...a) => ((f) => (f.length ? Math.max(...f) : NaN))(finiteOf(a)),
  rowsum: (...a) => ((f) => (f.length ? sumOf(f) : NaN))(finiteOf(a)),
  rown: (...a) => finiteOf(a).length,
};

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
  ...ROW_FUNCS,
};
export const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };
