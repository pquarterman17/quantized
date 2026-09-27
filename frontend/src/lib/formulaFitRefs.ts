// P2.5 fitted-value use in worksheet formulas — the two special forms:
//
//   fit("Model", "param")   a fitted parameter of the dataset's saved fit
//   fit("Model").param      the same, for a parameter name that is a plain
//                           identifier; `p0`, `p1`, … index any model
//   fitval("Model", expr)   the fitted model evaluated at `expr`
//
// Only the dataset's OWN saved fit (`Dataset.fitSpec`, the last fit the Curve
// Fit workshop or quick-fit ran) can be referenced — the model name is there to
// refuse when that fit is not the one the formula means. The numbers are never
// looked up live at evaluation: lib/derivedColumn.ts resolves them into a
// `FitRefSnapshot` on the column (`derived.fits`) when the column is created,
// and lib/derivedFitRefs.refreshFitRefs re-resolves it whenever the fit changes
// (scheduled lazily by the fit's writers, so it lands a tick after the fit).
// So recompute stays a pure function of (data, formulas) like every other
// formula, and a missing / different / non-converged fit is an explicit
// per-column error ("missing"), never a silently kept old number.
//
// fitval() evaluates the snapshot's `expr` — the model written in this same
// formula language over `x` and `p0..pn` (lib/derivedFitModels.ts, only
// for the closed-form models ported there) — compiled once per snapshot.

import type { ParserOps } from "./formulaRowFns";
import type { FitRefSnapshot, FormulaFn, FormulaRowContext } from "./formulaTypes";

function text(ops: ParserOps): string {
  const t = ops.eat();
  if (t?.t !== "str") throw new Error("expected text in quotes");
  return t.v;
}

function snap(ex: FormulaRowContext | undefined, model: string): FitRefSnapshot {
  const s = ex?.fits?.find((f) => f.model === model);
  if (!s || s.missing) throw new Error(`fit "${model}": ${s ? s.missing : "not resolved"}`);
  return s;
}

const compiledModels = new WeakMap<FitRefSnapshot, FormulaFn>();

/** Parse `fit(` / `fitval(` (name and "(" already eaten); `undefined` for any
 *  other name. `compile` is formula.ts's compileFormula (passed in, so this
 *  module does not import formula.ts back). */
export function tryParseFitRef(
  fname: string,
  ops: ParserOps,
  compile: (src: string) => FormulaFn,
): { fn: FormulaFn } | undefined {
  if (fname !== "fit" && fname !== "fitval") return undefined;
  const model = text(ops);
  if (fname === "fitval") {
    ops.expectOp(",");
    const arg = ops.parseExpr();
    ops.expectOp(")");
    return {
      fn: (c, ex) => {
        const s = snap(ex, model);
        if (!s.expr) throw new Error(`fitval "${model}": no model formula`);
        let m = compiledModels.get(s);
        if (!m) compiledModels.set(s, (m = compile(s.expr)));
        const mc: Record<string, number> = { x: arg(c, ex) };
        s.params.forEach((v, i) => (mc[`p${i}`] = v));
        return m(mc);
      },
    };
  }
  let param: string;
  const t = ops.peek();
  if (t?.t === "op" && t.v === ",") {
    ops.eat();
    param = text(ops);
    ops.expectOp(")");
  } else {
    ops.expectOp(")");
    ops.expectOp(".");
    const n = ops.eat();
    if (n?.t !== "name") throw new Error("expected a parameter name");
    param = n.v;
  }
  return {
    fn: (_c, ex) => {
      const s = snap(ex, model);
      const i = s.paramNames.indexOf(param);
      const v = s.params[i >= 0 ? i : /^p\d+$/.test(param) ? Number(param.slice(1)) : -1];
      if (typeof v !== "number") throw new Error(`fit "${model}" has no parameter "${param}"`);
      return v;
    },
  };
}
