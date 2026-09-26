// Editable starting values and bounds for a REGISTRY fit model (MAIN_PLAN #30).
//
// The custom-equation path has had a guess/min/max table since it shipped; the
// registry path did not, which is why the plan recorded starting values and
// bounds as "design-constrained — registry fits expose no user bounds". That
// was simply wrong: `FitModel` carries `paramNames`, default `p0`, `lb` and
// `ub`, and both `calc.fitting.curve_fit` and `/api/fitting/fit` have accepted
// `p0`/`lower`/`upper`/`fixed` all along. Nothing was blocked; the control was
// just missing.
//
// Rows hold TEXT while editing (an empty bound means unbounded, and a
// half-typed "-" must not be parsed as a number mid-keystroke); parsing and
// validation happen once, at fit time.

import { ALL_HELD_ERROR, allHeld, checkParamRow } from "./paramRowCheck";
import type { FitModel } from "./types";

export interface FitParamRow {
  name: string;
  /** Starting value. Blank falls back to the model's default. */
  start: string;
  /** "" = unbounded. */
  min: string;
  /** "" = unbounded. */
  max: string;
  /** Hold this parameter at its start value instead of fitting it. */
  fixed: boolean;
}

export interface ParsedFitParams {
  p0: number[];
  /** Parallel to p0; -Infinity where unbounded, which is what the backend
   *  defaults to when `lower` is omitted. */
  lower: number[];
  upper: number[];
  fixed: boolean[];
  /** Set when the rows cannot be used — the caller refuses to fit and says why
   *  rather than sending a request the backend will reject. */
  error?: string;
}

/** Seed rows from a model's registry defaults. */
export function rowsFromModel(model: FitModel | undefined): FitParamRow[] {
  if (!model) return [];
  return model.paramNames.map((name, i) => ({
    name,
    start: String(model.p0[i] ?? 1),
    min: model.lb[i] == null ? "" : String(model.lb[i]),
    max: model.ub[i] == null ? "" : String(model.ub[i]),
    fixed: false,
  }));
}

/** Re-seed for a new model, KEEPING edits for parameters that survive by name.
 *
 *  Models often share parameter names (`amp`, `center`, `sigma`), and silently
 *  discarding a hand-tuned start when flipping Gaussian→Lorentzian would be a
 *  small betrayal of work the user just did. */
export function rowsForModel(
  model: FitModel | undefined,
  previous: readonly FitParamRow[],
): FitParamRow[] {
  return rowsFromModel(model).map((fresh) => {
    const kept = previous.find((p) => p.name === fresh.name);
    return kept ? { ...kept } : fresh;
  });
}

/** Reset every row to the model's registry defaults, discarding edits. */
export function resetRows(model: FitModel | undefined): FitParamRow[] {
  return rowsFromModel(model);
}

/** Parse the table into the vectors `/api/fitting/fit` expects.
 *
 *  Validation is deliberately strict about the one mistake that produces a
 *  confusing FAILURE rather than a bad answer — min above max, which the
 *  bounded solver cannot satisfy at all. */
export function parseFitParams(
  rows: readonly FitParamRow[],
  model: FitModel | undefined,
): ParsedFitParams {
  const empty: ParsedFitParams = { p0: [], lower: [], upper: [], fixed: [] };
  if (!model || rows.length === 0) return empty;

  const p0: number[] = [];
  const lower: number[] = [];
  const upper: number[] = [];
  const fixed: boolean[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    // Shared with the equation table (lib/paramRowCheck); here a blank start
    // falls back to the model's default and a blank bound is unbounded.
    const r = checkParamRow(
      { name: row.name, start: row.start, min: row.min, max: row.max, held: row.fixed },
      { startLabel: "start", blankStart: model.p0[i] ?? 1 },
    );
    if ("error" in r) return { ...empty, error: r.error };
    p0.push(r.start);
    lower.push(r.lo ?? Number.NEGATIVE_INFINITY);
    upper.push(r.hi ?? Number.POSITIVE_INFINITY);
    fixed.push(row.fixed);
  }
  if (allHeld(fixed)) return { ...empty, error: ALL_HELD_ERROR };
  return { p0, lower, upper, fixed };
}

/** Have the rows been changed from the model's defaults?
 *
 *  Used to keep the recipe honest AND the request lean: an untouched table is
 *  the registry default, so recording or sending it would add noise that says
 *  nothing about what the user actually chose. */
export function rowsAreDefault(
  rows: readonly FitParamRow[],
  model: FitModel | undefined,
): boolean {
  const base = rowsFromModel(model);
  if (base.length !== rows.length) return false;
  return base.every(
    (b, i) =>
      b.start === rows[i].start &&
      b.min === rows[i].min &&
      b.max === rows[i].max &&
      rows[i].fixed === false,
  );
}

// The ±Infinity <-> null wire encoding lives in ./fitBoundsWire (eager code
// needs it without this module); re-exported so importers are unchanged.
export { boundsForWire, boundsFromWire } from "./fitBoundsWire";
