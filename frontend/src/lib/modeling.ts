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

// P3.4 (docs/performance_envelope.md finding 11's divergence investigation):
// `channelModelingType` is called INLINE IN RENDER, with no memoization
// anywhere upstream, from every per-channel UI row that shows a modeling-type
// badge (ChannelsCard's x-axis-type select, the DataFilter/GraphBuilder/
// StatsChooser/Tabulate workshops' categorical-column pickers, drag-axis drop
// targets, …) — none of those callers cache the result themselves. At 1M
// rows `inferModelingType`'s `column.map` + `Set` construction measured
// ~100-300ms PER CHANNEL (instrumented via CDP profiling), and a dataset's
// channel set never changes without its `.values` array also getting a new
// reference (the store's immutable-update convention — corrections/formula/
// edit actions always replace `DataStruct.values` wholesale, never mutate it
// in place), so caching keyed on that array reference is exactly as fresh as
// every other memoization in this codebase that keys off a Dataset/DataStruct
// reference (e.g. usePlotPayload's `useMemo([active, ...])`). A WeakMap
// (rather than a plain Map) means a dataset that's fully replaced/removed
// lets its cache entry get garbage-collected instead of leaking forever.
const modelingTypeCache = new WeakMap<readonly (readonly number[])[], Map<number, ModelingType>>();

/** The effective type of a dataset channel: the user's override when set,
 *  otherwise the inferred type of that column (cached per `(values, channel)`
 *  — see the cache's doc above for why keying on the `values` array
 *  reference is safe). */
export function channelModelingType(ds: Dataset, channel: number): ModelingType {
  const override = ds.channelTypes?.[channel];
  if (override) return override;
  const values = ds.data.values;
  let byChannel = modelingTypeCache.get(values);
  if (!byChannel) {
    byChannel = new Map();
    modelingTypeCache.set(values, byChannel);
  }
  let cached = byChannel.get(channel);
  if (cached === undefined) {
    cached = inferModelingType(values.map((row) => row[channel]));
    byChannel.set(channel, cached);
  }
  return cached;
}

/** True when the type is treated as discrete levels (nominal or ordinal) —
 *  the switch that makes an axis categorical / a drop produce boxes. */
export function isCategorical(t: ModelingType): boolean {
  return t !== "continuous";
}
