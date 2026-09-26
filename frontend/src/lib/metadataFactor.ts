// Metadata → factors (PRIMARY_SOFTWARE_AUDIT_PLAN P2.5): promote one metadata
// field to a per-row FACTOR column — every row of a dataset gets that
// dataset's value, so data from several files can be grouped, faceted or
// merged by it. Pure planning + the column it produces; the commit is
// lib/metadataRun.ts.
//
// THE COLUMN IS A COMPUTED COLUMN (`Dataset.formulas`), appended after every
// existing column exactly like a recode (store/recode.ts). Deliberately not a
// new base column: a base column would have to go BEFORE the computed ones
// (they are always the last `formulas.length` columns), renumbering every
// computed column and every channel-indexed binding on them (figure bindings,
// fit specs, error roles, filters — lib/channelRemap.ts is the size of that
// ripple). Appended as a computed column nothing moves, and it survives
// corrections re-applies and .dwk save/reopen through the existing formulas
// pass-through.
//
// Its `expr` is the constant itself — the category code `0`, the number, or
// `0/0` (NaN) when the dataset has no value — so the ordinary evaluator (and
// the incremental single-cell path) computes it with no special case. `factor`
// carries the provenance (which field, as what, the raw value) and, for a
// categorical factor, its one-level table, which `lib/formula.ts` installs as
// the column's `cat_levels`.
//
// MISSING IS NEVER DEFAULTED: a dataset without the field gets a blank (NaN)
// column and is named in the plan's `missing`, the commit's status and the
// pipeline log.

import { isPresent, metaValue, pathLabel, type MetaPath, type MetaScalar } from "./metadataKeys";
import type { ComputedColumn } from "./types";

export type FactorAs = "categorical" | "numeric";

/** Stored on `ComputedColumn.factor`. `value: null` = the dataset had none. */
export interface FactorSpec {
  source: "metadata";
  path: MetaPath;
  as: FactorAs;
  value: MetaScalar | null;
  /** Categorical only: the column's level table (`[]` when missing). */
  levels?: string[];
}

const NUMERIC_TEXT = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** A value as a number: a number itself, or text that is exactly one plain
 *  number ("300", " 1e-3 "). "300 K" is NOT — the cleanup's unit parse is what
 *  turns that into 300 with a unit. */
export function numericOf(v: MetaScalar): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string" && NUMERIC_TEXT.test(v.trim())) return Number(v.trim());
  return null;
}

interface Target {
  id: string;
  name: string;
  data: { labels: string[]; metadata: Record<string, unknown> };
}

export interface FactorRow {
  id: string;
  name: string;
  value: MetaScalar | undefined;
  /** What every row of this dataset will show ("" = blank). */
  cell: string;
  unit: string;
}

export interface FactorPlan {
  as: FactorAs;
  name: string;
  rows: FactorRow[];
  /** Names of the datasets with no value — their column is blank. */
  missing: string[];
  /** Numeric only: the distinct units, when the datasets disagree — each
   *  column keeps its own dataset's unit (and a later merge asks before
   *  mixing them, lib/appendWarnings' unit-mismatch confirm). */
  unitsDiffer: string[];
  /** Why the promotion cannot be committed, or null. */
  blocked: string | null;
}

/** The unit a numeric factor carries: a sibling `<key>_unit` text field (what
 *  the cleanup's unit parse writes), else none. */
function unitOf(meta: Record<string, unknown>, path: MetaPath): string {
  const u = metaValue(meta, [...path.slice(0, -1), `${path[path.length - 1]}_unit`]);
  return typeof u === "string" ? u.trim() : "";
}

/** Plan promoting `path` over `targets`. `as: "auto"` is numeric when every
 *  present value is a number, else categorical. Interactively, a field NO
 *  picked dataset carries is refused (a whole-selection blank column is
 *  surely a wrong pick); a pipeline REPLAY (`replay`) applies the recorded
 *  step to one file at a time, and a file without the field gets the same
 *  blank, reported column any other dataset without it gets. */
export function planFactor(
  targets: readonly Target[],
  path: MetaPath,
  as: FactorAs | "auto",
  columnName: string,
  replay = false,
): FactorPlan {
  const values = targets.map((t) => metaValue(t.data.metadata, path));
  const present = values.filter(isPresent);
  const kind: FactorAs =
    as !== "auto" ? as : present.length && present.every((v) => numericOf(v) !== null) ? "numeric" : "categorical";
  const name = columnName.trim();
  const rows = targets.map((t, i): FactorRow => {
    const v = values[i];
    const ok = isPresent(v);
    const n = ok ? numericOf(v) : null;
    const cell = !ok ? "" : kind === "numeric" ? (n === null ? String(v) : String(n)) : String(v);
    return { id: t.id, name: t.name, value: ok ? v : undefined, cell, unit: kind === "numeric" ? unitOf(t.data.metadata, path) : "" };
  });
  const missing = rows.filter((r) => r.value === undefined).map((r) => r.name);
  let blocked: string | null = null;
  const bad = rows.find((r) => r.value !== undefined && kind === "numeric" && numericOf(r.value) === null);
  const clash = targets.find((t) => t.data.labels.some((l) => l.trim().toLowerCase() === name.toLowerCase()));
  if (!targets.length) blocked = "Pick at least one dataset.";
  else if (!name) blocked = "Name the new column.";
  else if (!present.length && !replay) blocked = `No picked dataset has a value for “${pathLabel(path)}”.`;
  else if (bad) blocked = `“${String(bad.value)}” in ${bad.name} is not a number — promote as categorical, or clean the values first.`;
  else if (clash) blocked = `${clash.name} already has a column named “${name}” — pick another name.`;
  const units = [...new Set(rows.filter((r) => r.value !== undefined).map((r) => r.unit))];
  return { as: kind, name, rows, missing, unitsDiffer: units.length > 1 ? units : [], blocked };
}

/** The computed column one plan row adds to its dataset. */
export function factorColumn(plan: FactorPlan, row: FactorRow, path: MetaPath): ComputedColumn {
  const value = row.value ?? null;
  const factor: FactorSpec = { source: "metadata", path: [...path], as: plan.as, value };
  let expr = "0/0";
  if (plan.as === "categorical") {
    factor.levels = value === null ? [] : [String(value)];
    if (value !== null) expr = "0";
  } else if (value !== null) {
    expr = String(numericOf(value));
  }
  return { name: plan.name, expr, deps: [], ...(row.unit ? { unit: row.unit } : {}), factor };
}
