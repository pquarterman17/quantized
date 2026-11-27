// Complex numbers inside a worksheet formula (plan item 33; the spec is
// plans/COMPLEX_FORMULA_CONTRACT.md, decisions C1-C11). Part of the LAZY
// formula chunk: lib/formulaRefs.ts registers `COMPLEX_OPS` with the extension
// seam (lib/formulaExt.ts), and the eager parser (lib/formulaParser.ts) hands
// every operator and call of a formula that USES the syntax to it.
//
// A complex value exists only while an expression is evaluated (C1): a `Cx`
// travels through the same closures as a number, and the formula's final gate
// (`=` below) turns it back into one number per row or an error (C6). Where a
// complex value comes from is exactly `complex(re, im)`, `polar(r, theta)` and
// an imaginary literal (`2i`, which lib/formulaTokenize.ts reads as
// `complex(0, 2)`), so a formula without those names never reaches this file
// and keeps its result bit for bit (C3).
//
// Typing follows where a value CAME FROM, not what it equals (C3): arithmetic
// is real unless an operand is a `Cx`, so `sqrt(-1)` stays blank while
// `sqrt(complex(-1, 0))` is `i`. A function that has a complex form uses it
// only for a `Cx` argument; any other function takes the real part of a `Cx`
// whose imaginary part is exactly 0 and refuses the rest.
//
// A `Cx` that leaks into code that has never heard of it must not become a
// number: `valueOf` gives NaN, so real arithmetic on one is a blank, never a
// wrong value. The places that would otherwise treat an object as true (a
// condition, and/or/not, a comparison) are all routed through here.

import type { ComplexOps } from "./formulaExt";
import { COMPLEX_RESULT_ERROR } from "./formulaComplexNames";
import type { FormulaFn, FormulaRowContext } from "./formulaTypes";
import { applyAnd, applyCompare, applyNot, applyOr } from "./formulaTypes";

export class Cx {
  constructor(
    readonly re: number,
    readonly im: number,
  ) {}
  valueOf(): number {
    return NaN;
  }
}

type Val = number | Cx;
type Ev = (c: Record<string, number>, ex?: FormulaRowContext) => Val;
type Real = (...a: number[]) => number;

const asFn = (f: Ev): FormulaFn => f as unknown as FormulaFn;
const reOf = (v: Val): number => (typeof v === "number" ? v : v.re);
const imOf = (v: Val): number => (typeof v === "number" ? 0 : v.im);

const REAL_HINT = "takes a real number: use re(), im(), abs() or arg() first";

/** The real number `v` stands for, for a function or operator that only has a
 *  real form: a blank part gives a blank, a non-zero imaginary part an error. */
function realOf(v: Val, name: string): number {
  if (typeof v === "number") return v;
  if (Number.isNaN(v.re) || Number.isNaN(v.im)) return NaN;
  if (v.im === 0) return v.re;
  throw new Error(`${name} ${REAL_HINT}`);
}

/** Division of a + bi by c + di (Smith's method); complex zero is a blank, never an infinity. */
function cdiv(a: number, b: number, c: number, d: number): Val {
  if (c === 0 && d === 0) return NaN;
  if (Math.abs(c) >= Math.abs(d)) {
    const r = d / c;
    const den = c + d * r;
    return new Cx((a + b * r) / den, (b - a * r) / den);
  }
  const r = c / d;
  const den = c * r + d;
  return new Cx((a * r + b) / den, (b * r - a) / den);
}

/** z^n for a whole n by repeated squaring, so (1+2i)^2 is exact. */
function ipow(re: number, im: number, n: number): Val {
  let rr = 1;
  let ri = 0;
  let br = re;
  let bi = im;
  for (let e = Math.abs(n); e > 0; e = Math.floor(e / 2)) {
    if (e % 2 === 1) [rr, ri] = [rr * br - ri * bi, rr * bi + ri * br];
    [br, bi] = [br * br - bi * bi, 2 * br * bi];
  }
  return n < 0 ? cdiv(1, 0, rr, ri) : new Cx(rr, ri);
}

/** The principal log, with CPython's log1p form near |z| = 1 so a tiny result keeps its digits. */
function clog(re: number, im: number): Val {
  if (re === 0 && im === 0) return NaN;
  const h = Math.hypot(re, im);
  let lr: number;
  if (h >= 0.71 && h <= 1.73) {
    const [big, small] = Math.abs(re) >= Math.abs(im) ? [Math.abs(re), Math.abs(im)] : [Math.abs(im), Math.abs(re)];
    lr = Math.log1p((big - 1) * (big + 1) + small * small) / 2;
  } else lr = Math.log(h);
  return new Cx(lr, Math.atan2(im, re));
}

function cexp(re: number, im: number): Val {
  const m = Math.exp(re);
  return new Cx(m * Math.cos(im), m * Math.sin(im));
}

function cpow(a: Val, b: Val): Val {
  const [ar, ai, br, bi] = [reOf(a), imOf(a), reOf(b), imOf(b)];
  if (br === 0 && bi === 0) return new Cx(1, 0); // z^0 is 1
  if (bi === 0 && Number.isInteger(br) && Math.abs(br) <= 64) return ipow(ar, ai, br);
  if (ar === 0 && ai === 0) return br > 0 ? new Cx(0, 0) : NaN; // 0^w is 0 for Re(w) > 0, else blank
  const l = clog(ar, ai);
  if (typeof l === "number") return NaN;
  return cexp(br * l.re - bi * l.im, bi * l.re + br * l.im); // exp(w log z)
}

function csqrt(re: number, im: number): Val {
  if (re === 0 && im === 0) return new Cx(0, im);
  const s = Math.sqrt((Math.abs(re) + Math.hypot(re, im)) / 2);
  if (re >= 0) return new Cx(s, im / (2 * s));
  return new Cx(Math.abs(im) / (2 * s), im < 0 || Object.is(im, -0) ? -s : s);
}

const BIG = 355; // past this cosh/sinh of 2x overflow; the ratio has long since reached its limit

/** The one-argument functions that have a complex form, keyed by name; every other name takes a real number. */
const CFN: Record<string, (re: number, im: number) => Val> = {
  re: (re) => re,
  real: (re) => re,
  im: (_re, im) => im,
  imag: (_re, im) => im,
  abs: (re, im) => Math.hypot(re, im),
  arg: (re, im) => Math.atan2(im, re),
  angle: (re, im) => Math.atan2(im, re),
  conj: (re, im) => new Cx(re, -im),
  exp: cexp,
  log: clog,
  ln: clog,
  log10: (re, im) => {
    const l = clog(re, im);
    return typeof l === "number" ? l : new Cx(l.re / Math.LN10, l.im / Math.LN10);
  },
  sqrt: csqrt,
  sin: (a, b) => new Cx(Math.sin(a) * Math.cosh(b), Math.cos(a) * Math.sinh(b)),
  cos: (a, b) => new Cx(Math.cos(a) * Math.cosh(b), -Math.sin(a) * Math.sinh(b)),
  sinh: (a, b) => new Cx(Math.sinh(a) * Math.cos(b), Math.cosh(a) * Math.sin(b)),
  cosh: (a, b) => new Cx(Math.cosh(a) * Math.cos(b), Math.sinh(a) * Math.sin(b)),
  tan: (a, b) => (Math.abs(b) > BIG ? new Cx(0, Math.sign(b)) : cdiv(Math.sin(2 * a), Math.sinh(2 * b), Math.cos(2 * a) + Math.cosh(2 * b), 0)),
  tanh: (a, b) => (Math.abs(a) > BIG ? new Cx(Math.sign(a), 0) : cdiv(Math.sinh(2 * a), Math.sin(2 * b), Math.cosh(2 * a) + Math.cos(2 * b), 0)),
};

const both = (a: Val, b: Val): boolean => typeof a === "number" && typeof b === "number";
const cmp = (op: string) => (a: Val, b: Val): Val => applyCompare(op, realOf(a, op), realOf(b, op));
const realOnly = (op: string, f: (a: number, b: number) => number) => (a: Val, b: Val): Val => {
  if (both(a, b)) return f(a as number, b as number);
  throw new Error(`${op} ${REAL_HINT}`);
};

const BIN: Record<string, (a: Val, b: Val) => Val> = {
  "+": (a, b) => (both(a, b) ? (a as number) + (b as number) : new Cx(reOf(a) + reOf(b), imOf(a) + imOf(b))),
  "-": (a, b) => (both(a, b) ? (a as number) - (b as number) : new Cx(reOf(a) - reOf(b), imOf(a) - imOf(b))),
  "*": (a, b) => {
    if (both(a, b)) return (a as number) * (b as number);
    if (typeof a === "number") return new Cx(a * reOf(b), a * imOf(b));
    if (typeof b === "number") return new Cx(a.re * b, a.im * b);
    return new Cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
  },
  "/": (a, b) => (both(a, b) ? (a as number) / (b as number) : cdiv(reOf(a), imOf(a), reOf(b), imOf(b))),
  "^": (a, b) => (both(a, b) ? (a as number) ** (b as number) : cpow(a, b)),
  "//": realOnly("//", (a, b) => Math.floor(a / b)),
  "%": realOnly("%", (a, b) => a % b),
  "<": cmp("<"),
  "<=": cmp("<="),
  ">": cmp(">"),
  ">=": cmp(">="),
  "==": (a, b) => equal(a, b, true),
  "!=": (a, b) => equal(a, b, false),
  and: (a, b) => applyAnd(realOf(a, "and"), realOf(b, "and")),
  or: (a, b) => applyOr(realOf(a, "or"), realOf(b, "or")),
};

/** `==` / `!=` compare both parts; a blank part is a blank (the real rule). */
function equal(a: Val, b: Val, eq: boolean): Val {
  if (both(a, b)) return applyCompare(eq ? "==" : "!=", a as number, b as number);
  const [ar, ai, br, bi] = [reOf(a), imOf(a), reOf(b), imOf(b)];
  if ([ar, ai, br, bi].some(Number.isNaN)) return NaN;
  return (ar === br && ai === bi) === eq ? 1 : 0;
}

const rect = (r: number, t: number): Val => new Cx(r * Math.cos(t), r * Math.sin(t));

function make(name: string, ev: Ev[], fn?: Real): Ev {
  if (name === "complex" || name === "polar") {
    if (ev.length !== 2) throw new Error(`${name}() takes two arguments`);
    return (c, ex) => {
      const [p, q] = [realOf(ev[0](c, ex), name), realOf(ev[1](c, ex), name)];
      return name === "complex" ? new Cx(p, q) : rect(p, q);
    };
  }
  const cf = CFN[name];
  return (c, ex) => {
    const vals = ev.map((f) => f(c, ex));
    if (cf && vals.length > 0 && typeof vals[0] !== "number") return cf(vals[0].re, vals[0].im);
    if (!fn) throw new Error(`unknown function "${name}"`);
    return fn(...vals.map((v) => realOf(v, name)));
  };
}

export const COMPLEX_OPS: ComplexOps = {
  own: new Set(["complex", "polar", "if", "where"]),
  op(name, args, fn) {
    const ev = args as unknown as Ev[];
    const [a, b] = ev;
    const bin = BIN[name];
    let out: Ev;
    if (bin) out = (c, ex) => bin(a(c, ex), b(c, ex));
    else if (name === "neg") out = (c, ex) => ((v) => (typeof v === "number" ? -v : new Cx(-v.re, -v.im)))(a(c, ex));
    else if (name === "not") out = (c, ex) => applyNot(realOf(a(c, ex), "not"));
    else if (name === "?") out = (c, ex) => realOf(a(c, ex), "a condition");
    else if (name === "if" || name === "where") {
      if (ev.length !== 3) throw new Error(`${name}(condition, a, b) takes three arguments`);
      out = (c, ex) => {
        const cv = realOf(a(c, ex), "a condition");
        return Number.isNaN(cv) ? NaN : cv !== 0 ? b(c, ex) : ev[2](c, ex);
      };
    } else if (name === "=") {
      // The formula's result: one real number per row (C6).
      out = (c, ex) => {
        const v = a(c, ex);
        if (typeof v === "number") return v;
        if (Number.isNaN(v.re) || Number.isNaN(v.im)) return NaN;
        if (v.im === 0) return v.re;
        throw new Error(COMPLEX_RESULT_ERROR);
      };
    } else out = make(name, ev, fn);
    return asFn(out);
  },
};

/** The real-argument forms of the part functions, for a formula that has no
 *  complex value in it: `re(A)` is A, `im(A)` is 0, `arg(A)` is 0 or pi. */
export const REAL_COMPLEX_FUNCS: Record<string, Real> = {
  re: (v) => v,
  real: (v) => v,
  conj: (v) => v,
  im: (v) => (Number.isNaN(v) ? NaN : 0),
  imag: (v) => (Number.isNaN(v) ? NaN : 0),
  arg: (v) => Math.atan2(0, v),
  angle: (v) => Math.atan2(0, v),
};
