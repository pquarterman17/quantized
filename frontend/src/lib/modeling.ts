// Column modeling types (ORIGIN_GAP_PLAN #48) — JMP-style semantics for what
// a column MEANS: continuous (measurement axis), ordinal (ordered levels), or
// nominal (categories). Drives categorical axes, box/violin grouping, and the
// future Graph Builder's drop behavior. Inference is deliberately conservative:
// DataStruct columns are all numeric, so "nominal" only fires for few-distinct
// level-like columns; ordinal is never inferred (user override only).

import type { Dataset, ModelingType } from "./types";

/** Max distinct values a column may have and still read as nominal. */
const NOMINAL_MAX_LEVELS = 8;
/** Below this many finite samples we don't trust the inference. */
const MIN_SAMPLES = 12;

/** Infer a column's modeling type from its values. Conservative: numeric
 *  columns are continuous unless they look like repeated discrete levels
 *  (few distinct values, each level used more than once on average x3). */
export function inferModelingType(column: readonly number[]): ModelingType {
  const finite: number[] = [];
  for (const v of column) if (Number.isFinite(v)) finite.push(v);
  if (finite.length < MIN_SAMPLES) return "continuous";
  const distinct = new Set(finite);
  if (distinct.size <= NOMINAL_MAX_LEVELS && distinct.size * 3 <= finite.length) {
    return "nominal";
  }
  return "continuous";
}

/** The effective type of a dataset channel: the user's override when set,
 *  otherwise the inferred type of that column. */
export function channelModelingType(ds: Dataset, channel: number): ModelingType {
  const override = ds.channelTypes?.[channel];
  if (override) return override;
  return inferModelingType(ds.data.values.map((row) => row[channel]));
}

/** True when the type is treated as discrete levels (nominal or ordinal) —
 *  the switch that makes an axis categorical / a drop produce boxes. */
export function isCategorical(t: ModelingType): boolean {
  return t !== "continuous";
}
