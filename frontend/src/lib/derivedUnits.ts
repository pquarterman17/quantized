// P2.5 derived-column UNITS — a small, explicit unit algebra over unit STRINGS.
//
// What it does: parses a column's unit text into symbol^exponent factors,
// combines them through `* / ** sqrt`, requires equal units across `+ - % ==
// < … min max hypot atan2 if/where`, and makes transcendental functions
// (exp, log, sin, …) dimensionless. The derived unit is written back as text
// ("emu/g", "V·A", "m/s²", "J/(mol·K)", "K^0.5").
//
// Deliberate limits — each one refuses or says so, never guesses:
//   - NO conversion and NO prefix algebra. "mA" and "A" are different
//     symbols, so `A + B` over mA and A is REFUSED ("convert first"), and
//     `mA * A` is "mA·A", not "10⁻³ A²". Honest, if unsimplified.
//   - A unit text that is not a clean product/quotient ("J/mol K" — is that
//     J/(mol·K)?, "cm-3", "a.u.") is ONE opaque symbol: carried through
//     algebra intact and parenthesized where needed, never split.
//   - A column with no unit is UNKNOWN, not dimensionless. A product with an
//     unknown factor is unknown; a sum takes the known side's unit and says
//     it assumed so. A numeric literal is dimensionless in * / and adopts the
//     other side's unit in + - (so `T + 273.15` stays in T's unit).
//   - °C / °F are offset scales; scaling or raising them is flagged.
//   - Fitted parameters carry no recorded unit, so they are unknown.

import { isConstant, printExpr, type Node } from "./derivedExprAst";
import { compileFormula } from "./formula";

type Dim = ReadonlyMap<string, number>;
type U = { t: "known"; dim: Dim } | { t: "lit" } | { t: "unknown" };

export interface UnitEnv {
  /** The recorded unit of a column letter (or `x`); "" = none. */
  unitOf(name: string): string;
  /** How to name a column in a message ("B (R_xx)"). */
  label(name: string): string;
  /** The unit of the Y column a saved fit was made against, if recorded. */
  fitYUnit(model: string): string;
}

export interface UnitResult {
  /** The derived unit text; "" when unknown or dimensionless. */
  unit: string;
  dimensionless: boolean;
  warnings: string[];
  /** A dimensional contradiction (K + s): the column is refused. */
  error?: string;
}

const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const DIMENSIONLESS = new Set(["1", "-", "dimensionless", "unitless"]);
const AFFINE = new Set(["°C", "°F", "degC", "degF", "C°"]);
const TRANSCENDENTAL = new Set(["exp", "log", "ln", "log10", "log2", "sinh", "cosh", "tanh", "asin", "acos", "atan", "arcsin", "arccos", "arctan"]);
const TRIG = new Set(["sin", "cos", "tan"]);
const SAME_UNIT = new Set(["abs", "absolute", "floor", "ceil"]);
const MATCHING = new Set(["min", "max", "hypot"]);

const clean = (e: number): number => {
  const r = Math.round(e * 1e9) / 1e9;
  return Math.abs(r) < 1e-12 ? 0 : r;
};

// ── parsing ─────────────────────────────────────────────────────────────
function supToNumber(s: string): number | null {
  let neg = false;
  let digits = "";
  for (const ch of s) {
    if (ch === "⁻" && !digits && !neg) neg = true;
    else if (SUP.includes(ch)) digits += String(SUP.indexOf(ch));
    else return null;
  }
  return digits ? (neg ? -1 : 1) * Number(digits) : null;
}

const SYMBOL = /^(?:[A-Za-zµμÅΩ°%℃Ω][A-Za-zµμÅΩ°℃Ω_]*)/;
const EXPONENT = /^(?:\^|\*\*)\s*(\(?[-+]?\d+(?:\.\d+)?(?:\/\d+)?\)?)/;
const SUPERSCRIPT = /^[⁻]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+/;

/** A unit text as factors, or null when it is not a clean product/quotient. */
function parseFactors(text: string): Map<string, number> | null {
  const out = new Map<string, number>();
  const add = (sym: string, e: number) => out.set(sym, clean((out.get(sym) ?? 0) + e));
  let s = text.trim();
  let sign = 1;
  let afterSlash = false;
  let first = true;
  while (s.length) {
    let sep = "";
    const m = /^\s*([*·⋅/]|\s)\s*/.exec(s);
    if (!first) {
      if (!m) return null;
      sep = m[1].trim() || " ";
      s = s.slice(m[0].length);
      // "J/mol K": what follows a "/" must be ONE factor, then another "/"
      // or the end — anything else is ambiguous, so the text stays opaque.
      if (afterSlash && sep !== "/") return null;
      if (sep === "/") sign = -1;
      else sign = 1;
      afterSlash = sep === "/";
    }
    first = false;
    let sym: string;
    let inner: Map<string, number> | null = null;
    if (s.startsWith("(")) {
      const close = s.indexOf(")");
      if (close < 0) return null;
      inner = parseFactors(s.slice(1, close));
      if (!inner) return null;
      s = s.slice(close + 1);
      sym = "";
    } else if (/^1(?![\d.])/.test(s) && sign === 1 && out.size === 0) {
      s = s.slice(1); // "1/s"
      continue;
    } else {
      const sm = SYMBOL.exec(s);
      if (!sm) return null;
      sym = sm[0];
      s = s.slice(sym.length);
    }
    let e = 1;
    const em = EXPONENT.exec(s);
    const sup = SUPERSCRIPT.exec(s);
    if (em) {
      const raw = em[1].replace(/[()]/g, "");
      const [n, d] = raw.split("/");
      e = Number(n) / (d ? Number(d) : 1);
      if (!Number.isFinite(e)) return null;
      s = s.slice(em[0].length);
    } else if (sup) {
      e = supToNumber(sup[0]) ?? NaN;
      if (!Number.isFinite(e)) return null;
      s = s.slice(sup[0].length);
    }
    if (inner) for (const [k, v] of inner) add(k, v * e * sign);
    else add(sym, e * sign);
  }
  return out;
}

function parseUnit(text: string): Dim {
  const t = text.trim();
  if (DIMENSIONLESS.has(t.toLowerCase())) return new Map();
  const f = parseFactors(t);
  if (!f) return new Map([[t, 1]]);
  for (const [k, v] of [...f]) if (v === 0) f.delete(k);
  return f;
}

// ── formatting ──────────────────────────────────────────────────────────
function supOf(e: number): string {
  if (!Number.isInteger(e)) return `^${e}`;
  if (e === 1) return "";
  return [...String(e)].map((c) => (c === "-" ? "⁻" : SUP[Number(c)])).join("");
}
const symText = (s: string): string => (/[\s*·⋅/^]/.test(s) ? `(${s})` : s);

export function formatUnit(dim: Dim): string {
  const num: string[] = [];
  const den: string[] = [];
  for (const [s, e] of dim) {
    if (e > 0) num.push(symText(s) + supOf(e));
    else if (e < 0) den.push(symText(s) + supOf(-e));
  }
  if (!den.length) return num.join("·");
  const d = den.length > 1 ? `(${den.join("·")})` : den[0];
  return `${num.length ? num.join("·") : "1"}/${d}`;
}

// ── the algebra ─────────────────────────────────────────────────────────
function combine(a: Dim, b: Dim, k: number): Dim {
  const out = new Map(a);
  for (const [s, e] of b) out.set(s, clean((out.get(s) ?? 0) + k * e));
  for (const [s, e] of [...out]) if (e === 0) out.delete(s);
  return out;
}
function scale(a: Dim, k: number): Dim {
  const out = new Map<string, number>();
  for (const [s, e] of a) if (clean(e * k) !== 0) out.set(s, clean(e * k));
  return out;
}
const sameDim = (a: Dim, b: Dim): boolean => a.size === b.size && [...a].every(([s, e]) => b.get(s) === e);
const DIMLESS: U = { t: "known", dim: new Map() };

class UnitError extends Error {}

/** Derive the unit of an expression tree from its operands' recorded units. */
export function deriveUnit(root: Node, env: UnitEnv): UnitResult {
  const warnings: string[] = [];
  const unitless = new Set<string>();
  const warn = (w: string) => {
    if (!warnings.includes(w)) warnings.push(w);
  };
  const show = (u: U): string => (u.t === "known" ? formatUnit(u.dim) || "dimensionless" : u.t === "lit" ? "a number" : "no unit");
  const describe = (n: Node): string => (n.k === "var" ? env.label(n.name) : `"${printExpr(n)}"`);
  const affine = (u: U, what: string) => {
    if (u.t === "known" && [...u.dim.keys()].some((s) => AFFINE.has(s))) warn(`${what} scales an offset temperature scale (°C/°F); the result is not a temperature in that unit`);
  };

  /** + - % comparisons if/where min max: every operand the same unit. */
  function unify(nodes: Node[], units: U[], what: string): U {
    let known: { u: Extract<U, { t: "known" }>; n: Node } | null = null;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u.t !== "known") continue;
      if (!known) known = { u, n: nodes[i] };
      else if (!sameDim(known.u.dim, u.dim))
        throw new UnitError(
          `units differ in ${what}: ${describe(known.n)} is ${show(known.u)} but ${describe(nodes[i])} is ${show(u)} — no conversion is done; convert one first`,
        );
    }
    if (!known) return units.some((u) => u.t === "unknown") ? { t: "unknown" } : { t: "lit" };
    units.forEach((u, i) => {
      if (u.t === "unknown") warn(`${describe(nodes[i])} has no unit; ${what} assumes it is in ${show(known!.u)}`);
    });
    return known.u;
  }
  function dimless(n: Node, u: U, fn: string): void {
    if (u.t === "known" && u.dim.size) {
      if (TRIG.has(fn) && u.dim.size === 1 && u.dim.get("deg") === 1)
        warn(`${fn}() takes radians but ${describe(n)} is in deg; multiply by pi/180 first`);
      else if (!(TRIG.has(fn) && u.dim.size === 1 && u.dim.get("rad") === 1))
        warn(`${fn}() of ${describe(n)} (${show(u)}): the argument should be dimensionless; the result is treated as dimensionless`);
    }
  }
  function constValue(n: Node): number | null {
    if (!isConstant(n)) return null;
    const v = compileFormula(printExpr(n))({});
    return Number.isFinite(v) ? v : null;
  }
  function power(base: Node, exp: Node, what: string): U {
    const bu = u(base);
    const eu = u(exp);
    if (eu.t === "known" && eu.dim.size) throw new UnitError(`the exponent in ${what} has a unit (${show(eu)}); it must be a pure number`);
    if (bu.t !== "known" || !bu.dim.size) return bu.t === "unknown" ? bu : DIMLESS;
    const k = constValue(exp);
    if (k === null) {
      warn(`${what}: a unit raised to a non-constant power has no fixed unit; the result's unit is unknown`);
      return { t: "unknown" };
    }
    affine(bu, what);
    return { t: "known", dim: scale(bu.dim, k) };
  }

  function u(n: Node): U {
    // A subtree that reads no column (sqrt(2), 10**3, exp(1)) is a plain
    // number, exactly like a literal: it adopts the other side's unit in a sum.
    if (isConstant(n)) return { t: "lit" };
    switch (n.k) {
      case "num":
      case "const":
        return { t: "lit" };
      case "var": {
        const text = env.unitOf(n.name).trim();
        if (!text) unitless.add(env.label(n.name));
        return text ? { t: "known", dim: parseUnit(text) } : { t: "unknown" };
      }
      case "neg":
        return u(n.a);
      case "bin": {
        if (n.op === "+" || n.op === "-" || n.op === "%") return unify([n.a, n.b], [u(n.a), u(n.b)], `"${printExpr(n)}"`);
        if (n.op === "^" || n.op === "**") return power(n.a, n.b, `"${printExpr(n)}"`);
        const a = u(n.a);
        const b = u(n.b);
        if (a.t === "unknown" || b.t === "unknown") return { t: "unknown" };
        const ad = a.t === "known" ? a.dim : new Map<string, number>();
        const bd = b.t === "known" ? b.dim : new Map<string, number>();
        if (a.t === "lit" && b.t === "lit") return { t: "lit" };
        affine(a, `"${printExpr(n)}"`);
        affine(b, `"${printExpr(n)}"`);
        return { t: "known", dim: combine(ad, bd, n.op === "*" ? 1 : -1) };
      }
      case "cmp":
        unify([n.a, n.b], [u(n.a), u(n.b)], `"${printExpr(n)}"`);
        return DIMLESS;
      case "and":
      case "or":
        u(n.a);
        u(n.b);
        return DIMLESS;
      case "not":
        u(n.a);
        return DIMLESS;
      case "if":
        u(n.c);
        return unify([n.a, n.b], [u(n.a), u(n.b)], `the branches of "${printExpr(n)}"`);
      case "row":
        return DIMLESS;
      case "lag":
        u(n.n);
        return u({ k: "var", name: n.col });
      case "diff":
        return u({ k: "var", name: n.col });
      case "agg":
        return n.fn === "count" ? DIMLESS : u({ k: "var", name: n.col });
      case "fit":
        warn(`fit("${n.model}", "${n.param}"): fitted parameters carry no recorded unit, so the result's unit is unknown`);
        return { t: "unknown" };
      case "fitval": {
        u(n.arg);
        const y = env.fitYUnit(n.model).trim();
        return y ? { t: "known", dim: parseUnit(y) } : { t: "unknown" };
      }
      case "call": {
        const f = n.fn;
        if (f === "sqrt") return power(n.args[0], { k: "num", v: 0.5 }, `"${printExpr(n)}"`);
        if (f === "pow" || f === "power") return power(n.args[0], n.args[1], `"${printExpr(n)}"`);
        const us = n.args.map(u);
        if (f === "sign") return DIMLESS;
        if (SAME_UNIT.has(f)) return us[0];
        if (MATCHING.has(f)) return unify(n.args, us, `"${printExpr(n)}"`);
        if (f === "atan2") {
          unify(n.args, us, `"${printExpr(n)}"`);
          return DIMLESS;
        }
        if (TRANSCENDENTAL.has(f) || TRIG.has(f)) {
          dimless(n.args[0], us[0], f);
          return DIMLESS;
        }
        warn(`the unit of ${f}() is not defined here; the result's unit is unknown`);
        return { t: "unknown" };
      }
    }
  }

  try {
    const r = u(root);
    if (r.t === "unknown") {
      const who = [...unitless];
      const why = who.length ? `${who.join(", ")} ${who.length > 1 ? "have" : "has"} no recorded unit` : "see above";
      return { unit: "", dimensionless: false, warnings: [...warnings, `the result's unit is unknown (${why})`] };
    }
    const unit = r.t === "known" ? formatUnit(r.dim) : "";
    return { unit, dimensionless: unit === "", warnings };
  } catch (e) {
    if (e instanceof UnitError) return { unit: "", dimensionless: false, warnings, error: e.message };
    throw e;
  }
}
