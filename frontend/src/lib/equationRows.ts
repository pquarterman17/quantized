// Parameter table of a CUSTOM EQUATION fit (GOTO #1, audit P2.7) — the pure
// half of `components/workshops/curvefit/useEquationFit.ts`.
//
// Mirrors `lib/fitParams.ts` (the registry-model table): the same
// text-while-editing rows and hold ("fixed") flag, and the SAME per-row
// refusals, from one shared validator (`lib/paramRowCheck`) — unreadable
// numbers, min above max, a held value outside its own bounds
// (`calc.fitting.curve_fit` clips every start into the box, so it would
// silently move; the route refuses it too), and every parameter held.
//
// Pure: no React, no store.

import { lit } from "./macro";
import { ALL_HELD_ERROR, allHeld, checkParamRow } from "./paramRowCheck";

export interface EquationParamRow {
  name: string;
  guess: string; // kept as text while editing; parsed at fit time
  min: string; // "" = unbounded
  max: string; // "" = unbounded
  /** Hold this parameter at its guess instead of fitting it (P2.7). */
  fixed: boolean;
  /** Display unit (saved with the model, shown beside fitted values); "" = none. */
  unit: string;
}

export interface ParsedEquationRows {
  guesses: number[];
  /** null where unbounded — the wire shape `/api/fitting/equation/fit` takes. */
  lower: (number | null)[];
  upper: (number | null)[];
  fixed: boolean[];
}

export type EquationRowsParse = ParsedEquationRows | { error: string };

/** Parse the table into request vectors, or say (in words a user can act on)
 *  why it cannot be run. The first problem wins, in row order. The per-row
 *  checks are lib/paramRowCheck's, shared with the registry table. */
export function parseEquationRows(rows: readonly EquationParamRow[]): EquationRowsParse {
  const out: ParsedEquationRows = { guesses: [], lower: [], upper: [], fixed: [] };
  for (const r of rows) {
    // No blankStart: an equation has no default, so a blank guess is refused.
    const c = checkParamRow(
      { name: r.name, start: r.guess, min: r.min, max: r.max, held: r.fixed },
      { startLabel: "guess" },
    );
    if ("error" in c) return { error: c.error };
    out.guesses.push(c.start);
    out.lower.push(c.lo);
    out.upper.push(c.hi);
    out.fixed.push(r.fixed);
  }
  if (allHeld(out.fixed)) return { error: ALL_HELD_ERROR };
  return out;
}

/** Why the Fit button must stay disabled right now, or null when it can run.
 *  An empty table is not a "problem" to explain here: the validation line
 *  already says the equation has no free parameters. */
export function equationRunProblem(rows: readonly EquationParamRow[]): string | null {
  if (rows.length === 0) return null;
  const parsed = parseEquationRows(rows);
  return "error" in parsed ? parsed.error : null;
}

/** Seed a row for a parameter the equation just gained. */
export function newEquationRow(name: string): EquationParamRow {
  return { name, guess: "1", min: "", max: "", fixed: false, unit: "" };
}

/** The recorded macro step of an equation fit (P2.7 review): the script line
 *  and its params carry the WHOLE setup that ran — guesses, bounds (null =
 *  open) and hold flags — so replaying the script reproduces that fit, not a
 *  default-start one. `qz.fitEquation(equation, setup?)`: the second argument
 *  is optional, so a step recorded before it existed (equation only, i.e.
 *  the route's defaults: guesses of 1, no bounds, nothing held) is still a
 *  valid line and replays exactly as it always did. The step stays a
 *  script-only "ui" step; the pipeline runner skips it as before. */
export function equationFitStep(
  equation: string,
  setup: ParsedEquationRows,
): { code: string; params: Record<string, unknown> } {
  const { guesses, lower, upper, fixed } = setup;
  const opts = { guesses, lower, upper, fixed };
  return { code: `qz.fitEquation(${lit(equation)}, ${lit(opts)})`, params: { equation, ...opts } };
}
