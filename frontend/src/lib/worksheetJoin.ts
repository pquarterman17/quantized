// Keyed join (audit P2.5 — "previewed ... keyed join"). Split out of
// `lib/worksheetTransforms.ts` when the key grew a TEXT form; that module
// re-exports `joinWorksheets` so its callers are unchanged.
//
// A key is `-1` (X), a channel index, or the NAME of a text sidecar column
// (`metadata.text_columns ?? origin_text_columns`, lib/columnmeta.ts). A
// categorical channel (one with a `cat_levels` table) keys by its LEVEL
// STRING, never its code: two datasets rarely number their levels alike, so
// matching codes would pair "B" in one with "C" in the other.
//
// `joinKeyColumn` is the ONE place a key cell becomes a match string; the join
// itself and `analyzeJoin` (lib/transformWarnings.ts) both read it, so the
// warnings can never count keys the join treats differently.

import { categoricalLevels, labelForCode } from "./categorical";
import { originTextColumns } from "./columnmeta";
import type { DataStruct } from "./types";

export type JoinMode = "inner" | "left" | "right" | "full";
/** `-1` = X, `0..` = channel, a string = a text sidecar column's name. */
export type JoinKey = number | string;

export interface JoinKeyColumn {
  /** "text" for a text sidecar or a categorical channel, "number" otherwise. */
  kind: "number" | "text";
  /** Per source row: the string the join matches on, or null for a blank
   *  (non-finite number, missing level, empty text) — which matches nothing. */
  keys: (string | null)[];
}

/** The match strings of `key` in `ds`. Numbers key on `String(v)`, which
 *  merges -0 with 0 (as a Set of numbers does). Throws for a text column that
 *  does not exist. */
export function joinKeyColumn(ds: DataStruct, key: JoinKey): JoinKeyColumn {
  if (typeof key === "string") {
    const col = originTextColumns(ds).find((c) => c.shortName === key);
    if (!col) throw new Error(`there is no text column "${key}"`);
    return { kind: "text", keys: col.rows.map((s) => (s.trim() === "" ? null : s)) };
  }
  const levels = key >= 0 ? categoricalLevels(ds, key) : null;
  const raw = key < 0 ? ds.time : ds.values.map((row) => row[key]);
  if (levels) return { kind: "text", keys: raw.map((code) => labelForCode(levels, code)) };
  return { kind: "number", keys: raw.map((v) => (Number.isFinite(v) ? String(v) : null)) };
}

/** First row of each distinct key, in first-appearance order. */
function firstRows(keys: readonly (string | null)[]): Map<string, number> {
  const map = new Map<string, number>();
  keys.forEach((key, row) => {
    if (key !== null && !map.has(key)) map.set(key, row);
  });
  return map;
}

/** Exact key join. Duplicate keys retain their first row, making the
 *  operation deterministic and preventing an accidental many-to-many
 *  explosion. Rows whose key is blank are excluded on that side — a blank key
 *  cannot match anything — so a `left` join keeps every left row that HAS a
 *  key, not literally every left row.
 *
 *  A NUMERIC key becomes the output X, sorted ascending. A TEXT key cannot be
 *  an X, so the output X is the row number and the key is the first channel,
 *  categorical, in first-appearance order (left keys, then right-only ones).
 *  Every other channel keeps its own side's level table. */
export function joinWorksheets(
  left: DataStruct,
  right: DataStruct,
  leftKey: JoinKey,
  rightKey: JoinKey,
  mode: JoinMode = "inner",
): DataStruct {
  // Cheap upper-bound guard, before building any maps: a join's output can
  // never exceed left + right rows (full outer with disjoint keys). Refusing
  // on that bound keeps the "won't overwhelm the UI" contract without paying
  // to materialize a giant result first.
  if (left.time.length + right.time.length > 5_000_000) {
    throw new Error("Join would create more than 5,000,000 rows; filter or subset the inputs first");
  }
  const lk = joinKeyColumn(left, leftKey);
  const rk = joinKeyColumn(right, rightKey);
  if (lk.kind !== rk.kind) {
    throw new Error(`The keys do not match in kind: the left key is ${lk.kind === "text" ? "text" : "numeric"} but the right key is ${rk.kind === "text" ? "text" : "numeric"}. Pick two text or two numeric keys.`);
  }
  const text = lk.kind === "text";
  const leftMap = firstRows(lk.keys);
  const rightMap = firstRows(rk.keys);
  const keys = mode === "left"
    ? [...leftMap.keys()]
    : mode === "right"
      ? [...rightMap.keys()]
      : mode === "inner"
        ? [...leftMap.keys()].filter((key) => rightMap.has(key))
        : [...leftMap.keys(), ...[...rightMap.keys()].filter((key) => !leftMap.has(key))];
  // Numeric keys become X, and Map keys iterate in SOURCE-ROW order (`full`
  // appends every right-only key after all left keys regardless of value):
  // uPlot reads the LAST x as the axis max, so a non-monotonic x collapses the
  // range. Sort numerically. Text keys are not an axis and keep their order.
  if (!text) keys.sort((a, b) => Number(a) - Number(b));
  const leftChannels = left.labels.map((_, i) => i).filter((i) => i !== leftKey);
  const rightChannels = right.labels.map((_, i) => i).filter((i) => i !== rightKey);
  const leftNames = new Set(leftChannels.map((i) => left.labels[i]));
  const lead = text ? 1 : 0;
  const cat_levels: Record<number, string[]> = text && keys.length ? { 0: keys } : {};
  const level_order: Record<number, number[]> = {};
  const carry = (ds: DataStruct, channels: number[], offset: number) =>
    channels.forEach((c, j) => {
      const levels = categoricalLevels(ds, c);
      if (levels) cat_levels[offset + j] = levels;
      const order = ds.level_order?.[c];
      if (levels && Array.isArray(order)) level_order[offset + j] = [...order];
    });
  carry(left, leftChannels, lead);
  carry(right, rightChannels, lead + leftChannels.length);
  const keyName = typeof leftKey === "string" ? leftKey : leftKey < 0 ? "X" : left.labels[leftKey] || "Key";
  return {
    time: text ? keys.map((_, k) => k) : keys.map(Number),
    values: keys.map((key, k) => {
      const li = leftMap.get(key);
      const ri = rightMap.get(key);
      return [
        ...(text ? [k] : []),
        ...leftChannels.map((channel) => li === undefined ? Number.NaN : left.values[li]?.[channel] ?? Number.NaN),
        ...rightChannels.map((channel) => ri === undefined ? Number.NaN : right.values[ri]?.[channel] ?? Number.NaN),
      ];
    }),
    labels: [
      ...(text ? [keyName] : []),
      ...leftChannels.map((i) => left.labels[i]),
      ...rightChannels.map((i) => leftNames.has(right.labels[i]) ? `Right: ${right.labels[i]}` : right.labels[i]),
    ],
    units: [
      ...(text ? [""] : []),
      ...leftChannels.map((i) => left.units[i] ?? ""),
      ...rightChannels.map((i) => right.units[i] ?? ""),
    ],
    metadata: {
      worksheet_transform: "join",
      join_mode: mode,
      ...(text ? { join_key: "text", x_column_name: "Row" } : {}),
      left_metadata: left.metadata,
      right_metadata: right.metadata,
    },
    ...(Object.keys(cat_levels).length ? { cat_levels } : {}),
    ...(Object.keys(level_order).length ? { level_order } : {}),
  };
}
