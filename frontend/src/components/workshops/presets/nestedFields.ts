// Checks for a nested settings object in a preset adapter: every key of `spec`
// present, any other key rejected by name, each value checked (P6). The message
// reads "is not valid: setting 'x' ..." so the field is named at both levels.
// Lazy: imported only from workshop preset adapters.

import { parseFields, type FieldCheck } from "../../../lib/presetAdapter";

/** `extra` is a cross-field rule run once the keys and types are right. */
export const checkNested = <S extends object>(spec: { [K in keyof S & string]: FieldCheck }, extra?: (v: S) => string | null): FieldCheck => (v) => {
  const r = parseFields<S>(v, spec);
  if ("error" in r && Object.keys(r).length === 1) return `is not valid: ${r.error}`;
  const problem = extra ? extra(r as S) : null;
  return problem ? `is not valid: ${problem}` : null;
};

/** A whole number from `lo` to `hi` (hi omitted: no upper bound). */
export const checkWhole = (lo: number, hi?: number): FieldCheck => (v) =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && (hi === undefined || v <= hi)
    ? null
    : `must be a whole number ${hi === undefined ? `of ${lo} or more` : `from ${lo} to ${hi}`}`;

/** A finite number that is strictly between 0 and 1 (a probability or confidence level). */
export const checkProbability: FieldCheck = (v) =>
  typeof v === "number" && Number.isFinite(v) && v > 0 && v < 1 ? null : "must be a number between 0 and 1";

/** A finite number of at least `lo`. */
export const checkAtLeast = (lo: number): FieldCheck => (v) =>
  typeof v === "number" && Number.isFinite(v) && v >= lo ? null : `must be a number of ${lo} or more`;
