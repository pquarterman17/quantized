// Every closed-form model transcribed into lib/derivedFitModels.ts must give
// what the backend evaluator gives. The fixture was produced by
// `quantized.calc.fit_models.evaluate` (script body in the fixture's header
// comment below), with the registry's own parameter names.
//
//   from quantized.calc.fit_models import FIT_MODELS, evaluate
//   out[name] = {"names": FIT_MODELS[name]["paramNames"], "p": p, "x": xs,
//                "y": [float(v) for v in evaluate(name, xs, p)]}

import { describe, expect, it } from "vitest";

import fixture from "./__fixtures__/derivedFitModels.json";
import { FIT_MODEL_EXPRS, fitModelExpr } from "./derivedFitModels";
import { compileFormula } from "./formula";

type Case = { names: string[]; p: number[]; x: number[]; y: number[] };
const cases = fixture as Record<string, Case>;

describe("closed-form fit models match calc.fit_models", () => {
  it("covers exactly the transcribed models", () => {
    expect(Object.keys(FIT_MODEL_EXPRS).sort()).toEqual(Object.keys(cases).sort());
  });
  it.each(Object.keys(cases))("%s", (name) => {
    const c = cases[name];
    const m = fitModelExpr(name)!;
    expect(m.params).toEqual(c.names);
    const fn = compileFormula(m.expr);
    c.x.forEach((x, i) => {
      const ctx: Record<string, number> = { x };
      c.p.forEach((v, k) => (ctx[`p${k}`] = v));
      const got = fn(ctx);
      expect(Math.abs(got - c.y[i])).toBeLessThanOrEqual(1e-12 * Math.max(1, Math.abs(c.y[i])));
    });
  });
  it("is not fooled by an inherited key", () => {
    expect(fitModelExpr("constructor")).toBeUndefined();
  });
});
