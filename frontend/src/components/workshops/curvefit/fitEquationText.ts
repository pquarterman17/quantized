// A registry model's equation as text for the graph annotation (pure).
//
// The closed-form models carry their formula in lib/derivedFitModels.ts
// (`p0*exp(-x/p1) + p2`); here the p-indices become the model's parameter
// names. `equationPlain` is a readable one-liner; `equationTex` is the same
// formula in the strict mathtext subset lib/richtext.ts accepts (so screen and
// vector export agree), or null when the formula or a parameter name falls
// outside it. A model with no formula (Langevin, Voigt, plugins) has neither:
// callers print "y = Model(x)" and never invent an equation.

import { FIT_MODEL_EXPRS } from "../../../lib/derivedFitModels";

const GREEK: Record<string, string> = {
  α: "alpha", β: "beta", γ: "gamma", δ: "delta", ε: "epsilon", ζ: "zeta", η: "eta", θ: "theta", κ: "kappa",
  λ: "lambda", μ: "mu", ξ: "xi", ν: "nu", π: "pi", ρ: "rho", σ: "sigma", τ: "tau", φ: "phi", χ: "chi", ψ: "psi", ω: "omega",
  Γ: "Gamma", Δ: "Delta", Ω: "Omega",
};
const SUB = "₀₁₂₃₄₅₆₇₈₉";

/** A parameter name as a mathtext atom ("τ" -> \tau, "A₁"/"A1" -> A_{1},
 *  "xc" -> \mathrm{xc}), or null when it has no safe form (a "/" or "_"). */
export function latexName(name: string): string | null {
  const m = /^([^0-9₀-₉]+)([0-9₀-₉]*)$/u.exec(name);
  if (!m) return null;
  const base = m[1]!;
  const digits = [...(m[2] ?? "")].map((c) => (SUB.includes(c) ? String(SUB.indexOf(c)) : c)).join("");
  let tex: string;
  if (base.length === 1 && GREEK[base]) tex = `\\${GREEK[base]}`;
  else if (/^[A-Za-z]$/.test(base)) tex = base;
  else if (/^[A-Za-z]+$/.test(base)) tex = `\\mathrm{${base}}`;
  else return null;
  return digits ? `${tex}_{${digits}}` : tex;
}

const nameAt = (names: readonly string[]) => (i: number): string => names[i] ?? `p${i}`;

/** "y = A·exp(−x/τ) + C": the formula with parameter names, or "y = Model(x)". */
export function equationPlain(model: string, names: readonly string[]): string {
  const f = Object.hasOwn(FIT_MODEL_EXPRS, model) ? FIT_MODEL_EXPRS[model] : undefined;
  if (!f) return `y = ${model}(x)`;
  const name = nameAt(names);
  const body = f.expr
    .replace(/\bp(\d+)\b/g, (_m, i: string) => name(Number(i)))
    .replace(/\*\*/g, "^")
    .replace(/\*/g, "·")
    .replace(/\s+-\s+/g, " − ")
    .replace(/\s*\+\s*/g, " + ");
  return `y = ${body.replace(/\s+/g, " ").trim()}`;
}

interface Tok { t: "num" | "id" | "op"; v: string }

function tokens(src: string): Tok[] {
  const out: Tok[] = [];
  const re = /\s*(\d+(?:\.\d+)?(?:e[+-]?\d+)?|[A-Za-z_]\w*|\*\*|[-+*/()])/gy;
  let pos = 0;
  while (pos < src.length) {
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) {
      if (/^\s*$/.test(src.slice(pos))) break;
      throw new Error("bad token");
    }
    const v = m[1]!;
    out.push({ t: /^\d/.test(v) ? "num" : /^[A-Za-z_]/.test(v) ? "id" : "op", v });
    pos = re.lastIndex;
  }
  return out;
}

const FUNCS: Record<string, (a: string) => string> = {
  exp: (a) => `e^{${a}}`,
  sqrt: (a) => `\\sqrt{${a}}`,
  log: (a) => `\\mathrm{ln}(${a})`,
  tanh: (a) => `\\mathrm{tanh}(${a})`,
  sin: (a) => `\\mathrm{sin}(${a})`,
  cos: (a) => `\\mathrm{cos}(${a})`,
  abs: (a) => `|${a}|`,
};

interface Node { tex: string; paren: boolean }

const texNumber = (s: string): string => {
  const m = /^(.*?)e([+-]?\d+)$/.exec(s);
  return m ? `${m[1]}\\times10^{${Number(m[2])}}` : s;
};

/** The model's formula as mathtext, or null (no formula, or a name/function it cannot write). */
export function equationTex(model: string, names: readonly string[]): string | null {
  const f = Object.hasOwn(FIT_MODEL_EXPRS, model) ? FIT_MODEL_EXPRS[model] : undefined;
  if (!f) return null;
  const name = nameAt(names);
  try {
    const toks = tokens(f.expr);
    let i = 0;
    const peek = () => toks[i];
    const take = (v?: string): Tok => {
      const t = toks[i];
      if (!t || (v !== undefined && t.v !== v)) throw new Error("unexpected token");
      i++;
      return t;
    };
    const bare = (n: Node) => (n.paren ? n.tex.slice(1, -1) : n.tex);
    const atom = (): Node => {
      const t = take();
      if (t.t === "num") return { tex: texNumber(t.v), paren: false };
      if (t.v === "(") {
        const e = expr();
        take(")");
        return { tex: `(${e.tex})`, paren: true };
      }
      if (t.t !== "id") throw new Error("unexpected operator");
      if (peek()?.v === "(") {
        const fn = FUNCS[t.v];
        if (!fn) throw new Error(`function ${t.v}`);
        take("(");
        const e = expr();
        take(")");
        return { tex: fn(e.tex), paren: false };
      }
      if (t.v === "x") return { tex: "x", paren: false };
      if (t.v === "pi") return { tex: "\\pi", paren: false };
      const p = /^p(\d+)$/.exec(t.v);
      if (!p) throw new Error(`identifier ${t.v}`);
      const nm = latexName(name(Number(p[1])));
      if (nm === null) throw new Error("parameter name");
      return { tex: nm, paren: false };
    };
    const power = (): Node => {
      const base = atom();
      if (peek()?.v !== "**") return base;
      take("**");
      return { tex: `${base.tex}^{${bare(unary())}}`, paren: false };
    };
    const unary = (): Node => {
      if (peek()?.v === "-") {
        take("-");
        return { tex: `-${unary().tex}`, paren: false };
      }
      return power();
    };
    const term = (): Node => {
      let acc = unary();
      while (peek()?.v === "*" || peek()?.v === "/") {
        const op = take().v;
        const rhs = unary();
        acc = op === "*"
          ? { tex: `${acc.tex}\\,${rhs.tex}`, paren: false }
          : { tex: `\\frac{${bare(acc)}}{${bare(rhs)}}`, paren: false };
      }
      return acc;
    };
    const expr = (): Node => {
      let acc = term();
      while (peek()?.v === "+" || peek()?.v === "-") {
        const op = take().v;
        acc = { tex: `${acc.tex}${op}${term().tex}`, paren: false };
      }
      return acc;
    };
    const out = expr();
    if (i !== toks.length) throw new Error("trailing tokens");
    return out.tex;
  } catch {
    return null;
  }
}
