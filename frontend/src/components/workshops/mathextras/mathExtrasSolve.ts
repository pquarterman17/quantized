// Math extras: the two solver jobs added to the root / box ones, a system of N
// equations in N unknowns and a minimisation under equality / inequality
// constraints. Each reads its form fields, calls the route and returns the card
// (no dataset). Pure of React. A solution that did not converge is said so on
// the card, never shown as an answer.

import { optimizeConstrained, solveSystem } from "../../../lib/api/mathExtras";
import { fmt, parseConstants, parseLines, parseOptionalBounds, type MathForm, type Parsed } from "./mathExtrasForm";
import type { Card } from "./mathExtrasRun";

const ok = <T>(p: Parsed<T>): T => {
  if (p.error !== undefined) throw new Error(p.error);
  return p.value;
};

const KIND: Record<string, string> = { eq: "=", le: "≤", ge: "≥" };

/** N equations in N unknowns from the starting values. */
export async function runSystem(f: MathForm, signal: AbortSignal): Promise<Card> {
  const equations = ok(parseLines(f.equations, "equation"));
  const r = await solveSystem(
    { equations, guess: ok(parseConstants(f.guess)), constants: ok(parseConstants(f.constants)), method: f.sysMethod },
    signal,
  );
  return {
    title: r.converged ? "Solution" : "No solution found",
    rows: [
      ...r.variables.map((v, i): [string, string] => [v, fmt(r.point[i]!)]),
      ["Residual norm", fmt(r.residual_norm)],
      ...r.residuals.map((v, i): [string, string] => [`Residual, equation ${i + 1}`, fmt(v)]),
      ["Function evaluations", String(r.evaluations)],
    ],
    note: [...(r.warnings ?? []).map((w) => `Warning: ${w}.`), r.converged
      ? "A root-finder is local: another starting point can reach another solution."
      : `It did not converge (${r.message.replace(/\s+/g, " ").trim()}). The values above are where it stopped, not a solution: try other starting values.`].join(" "),
  };
}

/** Minimise / maximise under constraints; names the constraints that bind. */
export async function runConstrained(f: MathForm, signal: AbortSignal): Promise<Card> {
  const expr = f.expr.trim();
  if (expr === "") throw new Error("Enter an expression, for example (x - 2)^2 + (y - 2)^2.");
  const constraints = f.constraints.trim() === "" ? [] : ok(parseLines(f.constraints, "constraint"));
  const r = await optimizeConstrained(
    {
      expr, constraints, bounds: ok(parseOptionalBounds(f.bounds)), guess: ok(parseConstants(f.guess)),
      constants: ok(parseConstants(f.constants)), sense: f.sense, method: f.solver,
    },
    signal,
  );
  const active = r.constraints.filter((c) => c.active);
  const title = !r.feasible ? "No feasible point found" : f.sense === "min" ? "Minimum" : "Maximum";
  return {
    title,
    rows: [
      ...r.variables.map((v, i): [string, string] => [v, fmt(r.point[i]!)]),
      ["Value", fmt(r.value)],
      ...r.constraints.map((c, i): [string, string] => [
        `${i + 1}. ${c.text}`,
        c.active ? (c.kind === "eq" ? "equality" : "ACTIVE") : `slack ${fmt(c.slack ?? 0)}`,
      ]),
      ["Active constraints", active.length > 0 ? active.map((c) => `${KIND[c.kind]} ${c.text}`).join("; ") : "none"],
    ],
    note: [
      !r.feasible ? `The constraints are violated by ${fmt(r.max_violation)} at the best point found, so this is not a solution.` : "",
      r.feasible && !r.converged ? `The optimiser did not report convergence (${r.message.replace(/\s+/g, " ").trim()}).` : "",
      r.at_bound.length > 0 ? `On a bound: ${r.at_bound.join(", ")}.` : "",
      "A local optimiser, not a proof of a global optimum.",
    ].filter(Boolean).join(" "),
  };
}
