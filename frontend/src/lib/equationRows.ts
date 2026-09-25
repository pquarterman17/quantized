// Parameter table of a CUSTOM EQUATION fit (GOTO #1, audit P2.7) — the pure
// half of `components/workshops/curvefit/useEquationFit.ts`.
//
// Mirrors `lib/fitParams.ts` (the registry-model table) on purpose: the same
// text-while-editing rows, the same hold ("fixed") flag, and the same refusals
// before anything is sent — min above max, and every parameter held. One
// extra refusal the registry path does not need: a HELD value outside its own
// bounds. `calc.fitting.curve_fit` clips every start into the bound box, so a
// held value outside it would silently move instead of being kept; saying so
// here beats a 422 after the round trip (the route refuses it too).
//
// Pure: no React, no store.

export interface EquationParamRow {
  name: string;
  guess: string; // kept as text while editing; parsed at fit time
  min: string; // "" = unbounded
  max: string; // "" = unbounded
  /** Hold this parameter at its guess instead of fitting it (P2.7). */
  fixed: boolean;
}

export interface ParsedEquationRows {
  guesses: number[];
  /** null where unbounded — the wire shape `/api/fitting/equation/fit` takes. */
  lower: (number | null)[];
  upper: (number | null)[];
  fixed: boolean[];
}

export type EquationRowsParse = ParsedEquationRows | { error: string };

function parseBound(text: string, which: "min" | "max", name: string): number | null | string {
  if (text.trim() === "") return null;
  const v = Number(text);
  return Number.isFinite(v) ? v : `${which} for "${name}" is not a number`;
}

/** Parse the table into request vectors, or say (in words a user can act on)
 *  why it cannot be run. The first problem wins, in row order. */
export function parseEquationRows(rows: readonly EquationParamRow[]): EquationRowsParse {
  const out: ParsedEquationRows = { guesses: [], lower: [], upper: [], fixed: [] };
  for (const r of rows) {
    const g = Number(r.guess);
    if (r.guess.trim() === "" || !Number.isFinite(g)) {
      return { error: `guess for "${r.name}" is not a number` };
    }
    const lo = parseBound(r.min, "min", r.name);
    if (typeof lo === "string") return { error: lo };
    const hi = parseBound(r.max, "max", r.name);
    if (typeof hi === "string") return { error: hi };
    if (lo !== null && hi !== null && lo > hi) return { error: `"${r.name}": min is above max` };
    if (r.fixed && ((lo !== null && g < lo) || (hi !== null && g > hi))) {
      return { error: `"${r.name}" is held at ${r.guess.trim()}, outside its bounds` };
    }
    out.guesses.push(g);
    out.lower.push(lo);
    out.upper.push(hi);
    out.fixed.push(r.fixed);
  }
  if (rows.length > 0 && out.fixed.every(Boolean)) {
    return { error: "every parameter is held — nothing left to fit" };
  }
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
  return { name, guess: "1", min: "", max: "", fixed: false };
}
