// P2.5 DEFINED error propagation for derived columns: first-order (linear),
// uncorrelated —
//
//     σ_f² = Σᵢ (∂f/∂xᵢ · σᵢ)²
//
// over the input columns xᵢ that carry a bound symmetric error column σᵢ (the
// P1.6 error-role contract). The partial derivatives are taken SYMBOLICALLY on
// the expression tree and the result is written as an ordinary worksheet
// formula over the input and error columns (`sqrt((B * C)**2 + (A * D)**2)`),
// so the σ column is a plain computed column: it recomputes, undoes, records
// and round-trips like any other, and anyone can read exactly what it does.
//
// What "defined" means here, and where it stops (each stop is a refusal with
// its reason, never a quiet approximation):
//   - First order only: exact for sums and scalings, an approximation for
//     nonlinear f when σ is not small against the curvature.
//   - Inputs are treated as UNCORRELATED. Where two inputs share an upstream
//     column the caller says so (derivedColumn.ts) — the formula is still this.
//   - `if`/`where`: the condition is taken as exact; each row propagates
//     through the branch it took.
//   - Refused when an input with an error reaches: a comparison or logical
//     operator used as a value, `%`, `//`, floor/ceil/sign/min/max (not
//     differentiable where it matters), or a row-coupled form (lag, diff, the
//     aggregates) — those correlate rows, which this model does not describe.
//   - Fitted parameters are exact constants (their standard errors are not
//     stored with the saved fit).
//   - A row where a partial derivative is infinite or undefined (sqrt or log
//     at 0, a/b at b = 0) gives NaN or Inf there — the linearization does not
//     exist — even if that input's σ is 0.

import { columnsRead, parseExpr, printExpr, type Node } from "./derivedExprAst";

export class PropagationError extends Error {}

// ── constructors that fold the trivial cases, so the printed σ stays readable
const num = (v: number): Node => ({ k: "num", v });
const is = (n: Node, v: number): boolean => n.k === "num" && n.v === v;
const fold = (v: number, orElse: () => Node): Node => (Number.isFinite(v) ? num(v) : orElse());
const call = (fn: string, ...args: Node[]): Node => ({ k: "call", fn, args });

function neg(a: Node): Node {
  if (a.k === "num") return num(-a.v);
  return a.k === "neg" ? a.a : { k: "neg", a };
}
function add(a: Node, b: Node): Node {
  if (is(a, 0)) return b;
  if (is(b, 0)) return a;
  if (a.k === "num" && b.k === "num") return num(a.v + b.v);
  return { k: "bin", op: "+", a, b };
}
function sub(a: Node, b: Node): Node {
  if (is(b, 0)) return a;
  if (is(a, 0)) return neg(b);
  if (a.k === "num" && b.k === "num") return num(a.v - b.v);
  return { k: "bin", op: "-", a, b };
}
function mul(a: Node, b: Node): Node {
  if (is(a, 0) || is(b, 0)) return num(0);
  if (is(a, 1)) return b;
  if (is(b, 1)) return a;
  if (is(a, -1)) return neg(b);
  if (is(b, -1)) return neg(a);
  if (a.k === "num" && b.k === "num") return num(a.v * b.v);
  return { k: "bin", op: "*", a, b };
}
function div(a: Node, b: Node): Node {
  if (is(a, 0)) return num(0);
  if (is(b, 1)) return a;
  if (a.k === "num" && b.k === "num") return fold(a.v / b.v, () => ({ k: "bin", op: "/", a, b }));
  return { k: "bin", op: "/", a, b };
}
function pow(a: Node, b: Node): Node {
  if (is(b, 0)) return num(1);
  if (is(b, 1)) return a;
  if (a.k === "num" && b.k === "num") return fold(a.v ** b.v, () => ({ k: "bin", op: "**", a, b }));
  return { k: "bin", op: "**", a, b };
}

const dependsOn = (n: Node, v: string): boolean => columnsRead(n).has(v);

/** d(a**b): the three cases, so a constant exponent never grows a log(). */
function dPow(node: Node, a: Node, b: Node, da: Node, db: Node): Node {
  if (is(db, 0)) return mul(mul(b, pow(a, sub(b, num(1)))), da);
  if (is(da, 0)) return mul(mul(node, call("log", a)), db);
  return mul(node, add(mul(db, call("log", a)), div(mul(b, da), a)));
}

const UNARY: Record<string, (a: Node) => Node> = {
  sin: (a) => call("cos", a),
  cos: (a) => neg(call("sin", a)),
  tan: (a) => div(num(1), pow(call("cos", a), num(2))),
  asin: (a) => div(num(1), call("sqrt", sub(num(1), pow(a, num(2))))),
  acos: (a) => neg(div(num(1), call("sqrt", sub(num(1), pow(a, num(2)))))),
  atan: (a) => div(num(1), add(num(1), pow(a, num(2)))),
  sinh: (a) => call("cosh", a),
  cosh: (a) => call("sinh", a),
  tanh: (a) => div(num(1), pow(call("cosh", a), num(2))),
  exp: (a) => call("exp", a),
  log: (a) => div(num(1), a),
  log10: (a) => div(num(1), mul(a, call("log", num(10)))),
  log2: (a) => div(num(1), mul(a, call("log", num(2)))),
  sqrt: (a) => div(num(1), mul(num(2), call("sqrt", a))),
  abs: (a) => call("sign", a),
};
UNARY.ln = UNARY.log;
UNARY.arcsin = UNARY.asin;
UNARY.arccos = UNARY.acos;
UNARY.arctan = UNARY.atan;
UNARY.absolute = UNARY.abs;

function substitute(n: Node, map: (v: string) => Node | undefined): Node {
  if (n.k === "var") return map(n.name) ?? n;
  const rec = (c: Node) => substitute(c, map);
  switch (n.k) {
    case "neg":
    case "not":
      return { ...n, a: rec(n.a) };
    case "bin":
    case "cmp":
    case "and":
    case "or":
      return { ...n, a: rec(n.a), b: rec(n.b) };
    case "call":
      return { ...n, args: n.args.map(rec) };
    case "if":
      return { ...n, c: rec(n.c), a: rec(n.a), b: rec(n.b) };
    case "lag":
      return { ...n, n: rec(n.n) };
    case "fitval":
      return { ...n, arg: rec(n.arg) };
    default:
      return n;
  }
}

/** ∂n/∂v, symbolically. `modelExpr` gives a fitted model's formula (over x
 *  and p0..pn) so a fitval() argument can carry error through the model. */
export function derivative(n: Node, v: string, modelExpr: (model: string) => string | undefined): Node {
  const d = (c: Node) => derivative(c, v, modelExpr);
  const refuse = (what: string): never => {
    throw new PropagationError(`error propagation is not defined through ${what} (it reads a column with an error)`);
  };
  if (!dependsOn(n, v)) return num(0);
  switch (n.k) {
    case "var":
      return num(n.name === v ? 1 : 0);
    case "neg":
      return neg(d(n.a));
    case "bin": {
      const { a, b } = n;
      switch (n.op) {
        case "+":
          return add(d(a), d(b));
        case "-":
          return sub(d(a), d(b));
        case "*":
          return add(mul(d(a), b), mul(a, d(b)));
        case "/":
          return sub(div(d(a), b), div(mul(a, d(b)), pow(b, num(2))));
        case "^":
        case "**":
          return dPow(n, a, b, d(a), d(b));
        default:
          return refuse(`"${n.op}"`);
      }
    }
    case "if": {
      const [da, db] = [d(n.a), d(n.b)];
      return is(da, 0) && is(db, 0) ? num(0) : { k: "if", c: n.c, a: da, b: db };
    }
    case "call": {
      const f = n.fn;
      if (UNARY[f]) {
        const da = d(n.args[0]);
        return is(da, 0) ? da : mul(UNARY[f](n.args[0]), da);
      }
      if (f === "pow" || f === "power") return dPow(n, n.args[0], n.args[1], d(n.args[0]), d(n.args[1]));
      if (f === "atan2") {
        const [y, x] = n.args;
        return div(sub(mul(x, d(y)), mul(y, d(x))), add(pow(x, num(2)), pow(y, num(2))));
      }
      if (f === "hypot") return div(n.args.map((a) => mul(a, d(a))).reduce(add, num(0)), n);
      return refuse(`${f}()`);
    }
    case "fitval": {
      const expr = modelExpr(n.model);
      if (!expr) return refuse(`fitval("${n.model}") — no formula for that model`);
      const slope = substitute(derivative(parseExpr(expr), "x", modelExpr), (name) =>
        name === "x" ? n.arg : /^p\d+$/.test(name) ? { k: "fit", model: n.model, param: name } : undefined,
      );
      return mul(slope, d(n.arg));
    }
    case "lag":
    case "diff":
    case "agg":
      return refuse(`${n.k === "agg" ? n.fn : n.k}() (it couples rows)`);
    default:
      return refuse(`a comparison or logical operator`);
  }
}

export interface SigmaInput {
  /** The input column letter (or `x`). */
  name: string;
  /** Its bound error column's letter. */
  sigma: string;
}

/** The σ formula for `root` over the given inputs. Throws PropagationError
 *  when propagation is undefined, or when no input with an error matters. */
export function propagateSigma(
  root: Node,
  inputs: readonly SigmaInput[],
  modelExpr: (model: string) => string | undefined,
): { expr: string; used: SigmaInput[] } {
  const terms: Node[] = [];
  const used: SigmaInput[] = [];
  for (const inp of inputs) {
    const dv = derivative(root, inp.name, modelExpr);
    if (is(dv, 0)) continue;
    terms.push(mul(dv, { k: "var", name: inp.sigma }));
    used.push(inp);
  }
  if (!terms.length) throw new PropagationError("the result does not depend on any column that has a bound error column");
  const out =
    terms.length === 1 ? call("abs", terms[0]) : call("sqrt", terms.map((t) => pow(t, num(2))).reduce((s, t) => add(s, t)));
  return { expr: printExpr(out), used };
}
