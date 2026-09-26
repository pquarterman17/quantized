// One row validator for BOTH fit parameter tables (audit P2.7 review): the
// registry-model table (lib/fitParams) and the custom-equation table
// (lib/equationRows) used to carry their own copies of the same checks, and
// had already drifted in wording. What stays per table is only how a BLANK
// start is treated (the registry falls back to the model's default; an
// equation has no default, so blank is an error) and what the column is
// called ("start" / "guess"). A blank bound is an open side (null) for both.
// Pure: no React, no store.

export interface ParamRowInput {
  name: string;
  start: string;
  min: string;
  max: string;
  held: boolean;
}

export interface ParamRowNumbers {
  start: number;
  /** null = open side. */
  lo: number | null;
  hi: number | null;
}

export const ALL_HELD_ERROR = "every parameter is held — nothing left to fit";

/** A row's numbers, or the first reason it cannot be run, in a fixed order:
 *  unreadable start/min/max, min above max, then a HELD start outside its
 *  bounds (the engine clips every start into its bounds, so a held value
 *  there would silently move). `blankStart` undefined = a blank start is an
 *  error. */
export function checkParamRow(
  row: ParamRowInput,
  opts: { startLabel: string; blankStart?: number },
): ParamRowNumbers | { error: string } {
  const read = readParamNumber;
  const s = read(row.start);
  const start = s === null ? opts.blankStart : s;
  if (start === undefined) return { error: `${row.name}: ${opts.startLabel} is not a number` };
  const lo = read(row.min);
  if (lo === undefined) return { error: `${row.name}: min is not a number` };
  const hi = read(row.max);
  if (hi === undefined) return { error: `${row.name}: max is not a number` };
  if (lo !== null && hi !== null && lo > hi) return { error: `${row.name}: min is above max` };
  if (row.held && ((lo !== null && start < lo) || (hi !== null && start > hi))) {
    return { error: `${row.name}: held at ${start}, outside its bounds` };
  }
  return { start, lo, hi };
}

/** One cell of a row: null when blank, undefined when not a finite number. */
export function readParamNumber(text: string): number | null | undefined {
  const t = text.trim();
  if (t === "") return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : undefined;
}

/** Is every parameter held (so nothing is left to fit)? An empty table is not. */
export function allHeld(held: readonly boolean[]): boolean {
  return held.length > 0 && held.every(Boolean);
}
