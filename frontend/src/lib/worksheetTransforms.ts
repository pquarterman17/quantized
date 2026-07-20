import type { DataStruct } from "./types";

export type JoinMode = "inner" | "left" | "right" | "full";
export type AggregateMode = "mean" | "first" | "last";

const column = (ds: DataStruct, key: number): number[] =>
  key < 0 ? ds.time : ds.values.map((row) => row[key]);

function finiteKey(value: number): string | null {
  return Number.isFinite(value) ? String(value) : null;
}

function provenance(ds: DataStruct, operation: string): Record<string, unknown> {
  // Every reshape REPLACES the X axis (transpose -> channel index;
  // stack/unstack/join -> a different key column), so X-axis-identity metadata
  // carried from the source is stale. Dropping `time_is_datetime` in
  // particular stops the Inspector's date-format gate (TickFormat keys on it)
  // from re-opening on a provably-non-date axis — which would also feed the
  // date tick formatter out-of-range values. Fails closed: a reshaped datetime
  // dataset just won't offer date formatting until re-imported.
  const rest: Record<string, unknown> = { ...ds.metadata };
  for (const k of ["time_is_datetime", "time_timezone", "x_column_name", "x_column_unit"]) {
    delete rest[k];
  }
  return { ...rest, worksheet_transform: operation };
}

/** Transpose the numeric Y matrix. The new X is the original channel index;
 * each original row becomes one output channel. Original schema is retained in
 * metadata because per-column units cannot be represented after transposition. */
export function transposeWorksheet(ds: DataStruct): DataStruct {
  const rows = ds.values.length;
  const channels = ds.labels.length;
  if (rows > 2_000) throw new Error("Transpose would create more than 2,000 output columns; filter or subset rows first");
  // Cap the OTHER output axis too: the new time length is `channels`, which is
  // uncapped on its own (a 4096-channel detector scan × 2000 rows = 8.2M
  // cells). Match the 5M-cell budget the sibling transforms enforce.
  if (rows * channels > 5_000_000) {
    throw new Error("Transpose would create more than 5,000,000 cells; filter or subset the source first");
  }
  return {
    time: Array.from({ length: channels }, (_, i) => i),
    values: Array.from({ length: channels }, (_, channel) =>
      Array.from({ length: rows }, (_, row) => ds.values[row]?.[channel] ?? Number.NaN),
    ),
    labels: ds.time.map((x, row) => `Row ${row + 1} (x=${x})`),
    units: Array.from({ length: rows }, () => ""),
    metadata: {
      ...provenance(ds, "transpose"),
      transpose_source_labels: ds.labels,
      transpose_source_units: ds.units,
    },
  };
}

/** Wide-to-long numeric stack. Channel identity is both a numeric column and a
 * searchable text column so categorical plotting can show source labels. */
export function stackWorksheet(ds: DataStruct, channels: readonly number[]): DataStruct {
  const selected = [...new Set(channels)].filter((i) => i >= 0 && i < ds.labels.length);
  if (!selected.length) throw new Error("Select at least one valid channel");
  if (ds.time.length * selected.length > 5_000_000) {
    throw new Error("Stack would create more than 5,000,000 rows; filter or subset the source first");
  }
  const time: number[] = [];
  const values: number[][] = [];
  const sourceLabels: string[] = [];
  for (let row = 0; row < ds.time.length; row += 1) {
    for (const channel of selected) {
      time.push(ds.time[row]);
      values.push([channel, ds.values[row]?.[channel] ?? Number.NaN]);
      sourceLabels.push(ds.labels[channel] ?? `Channel ${channel + 1}`);
    }
  }
  return {
    time,
    values,
    labels: ["Source channel", "Value"],
    units: ["", "mixed"],
    metadata: {
      ...provenance(ds, "stack"),
      stack_source_channels: selected,
      origin_text_columns: { Source: sourceLabels },
    },
  };
}

/** Long-to-wide pivot over numeric key/category/value columns. Duplicate cells
 * use an explicit aggregation rule; missing combinations remain NaN. */
export function unstackWorksheet(
  ds: DataStruct,
  keyColumn: number,
  categoryColumn: number,
  valueColumn: number,
  aggregate: AggregateMode = "mean",
): DataStruct {
  const keys = column(ds, keyColumn);
  const categories = column(ds, categoryColumn);
  const values = column(ds, valueColumn);
  const keyOrder: number[] = [];
  const categoryOrder: number[] = [];
  const keySeen = new Set<string>();
  const categorySeen = new Set<string>();
  // Per-cell accumulators, NOT per-cell arrays. Collecting every duplicate
  // value first (`[...bucket, v]` per row) spread-copies the whole bucket on
  // every hit -- O(n^2) in the rows sharing a cell, which is the COMMON
  // long-form shape (a few setpoints x thousands of samples). The caps below
  // cannot save it: they bound DISTINCT key/category counts and run only
  // AFTER this loop, so even a 1x1 output can take minutes. No mode needs the
  // full list -- mean needs (sum, count), first/last need one slot -- so
  // accumulate in O(1) per row instead.
  const acc = new Map<string, number>();
  const hits = new Map<string, number>();
  for (let i = 0; i < keys.length; i += 1) {
    const key = finiteKey(keys[i]);
    const category = finiteKey(categories[i]);
    if (key === null || category === null || !Number.isFinite(values[i])) continue;
    if (!keySeen.has(key)) { keySeen.add(key); keyOrder.push(keys[i]); }
    if (!categorySeen.has(category)) { categorySeen.add(category); categoryOrder.push(categories[i]); }
    const cell = `${key}\u0000${category}`;
    const seen = hits.get(cell) ?? 0;
    if (aggregate === "mean") acc.set(cell, (acc.get(cell) ?? 0) + values[i]);
    else if (aggregate === "last" || seen === 0) acc.set(cell, values[i]);
    hits.set(cell, seen + 1);
  }
  const pick = (cell: string): number => {
    const n = hits.get(cell) ?? 0;
    if (!n) return Number.NaN;
    const total = acc.get(cell) ?? Number.NaN;
    return aggregate === "mean" ? total / n : total;
  };
  if (categoryOrder.length > 2_000) {
    throw new Error("Unstack would create more than 2,000 output columns; reduce category levels first");
  }
  // The category count caps columns, but a high-cardinality KEY column would
  // still produce an unbounded number of rows — cap total output cells too
  // (consistent with stack's 5M limit) so the "refuses transforms likely to
  // overwhelm the UI" contract holds on the row axis as well.
  if (keyOrder.length * categoryOrder.length > 5_000_000) {
    throw new Error("Unstack would create more than 5,000,000 cells; reduce key or category levels first");
  }
  // uPlot reads the LAST x value as the axis max (it assumes x ascends --
  // see dropTrailingEmptyRows in lib/plotdata.ts, which exists purely to
  // protect that invariant for imported data). keyOrder is FIRST-APPEARANCE
  // order, so an unsorted key column emitted a non-monotonic x and collapsed
  // the range on first view -- self-inflicting the very artifact we prune
  // imports to avoid. Sort the output x ascending. (Category order stays
  // first-appearance: it picks COLUMN order, which breaks no invariant.)
  const plotOrder = [...keyOrder].sort((a, b) => a - b);
  return {
    time: plotOrder,
    values: plotOrder.map((key) => categoryOrder.map((category) => pick(`${key}\u0000${category}`))),
    labels: categoryOrder.map((category) => `Category ${category}`),
    units: categoryOrder.map(() => valueColumn < 0 ? "" : (ds.units[valueColumn] ?? "")),
    metadata: { ...provenance(ds, "unstack"), unstack_aggregate: aggregate },
  };
}

/** Exact numeric key join. Duplicate keys retain their first row, making the
 * operation deterministic and preventing an accidental many-to-many explosion.
 * Rows whose join-column value is not finite (NaN/blank) are excluded on that
 * side — a non-finite key cannot match anything — so a `left` join keeps every
 * left row that HAS a finite key, not literally every left row. */
export function joinWorksheets(
  left: DataStruct,
  right: DataStruct,
  leftKey: number,
  rightKey: number,
  mode: JoinMode = "inner",
): DataStruct {
  // Cheap upper-bound guard, before building any maps: a join's output can
  // never exceed left + right rows (full outer with disjoint keys). Refusing
  // on that bound keeps the "won't overwhelm the UI" contract without paying
  // to materialize a giant result first.
  if (left.time.length + right.time.length > 5_000_000) {
    throw new Error("Join would create more than 5,000,000 rows; filter or subset the inputs first");
  }
  const leftKeys = column(left, leftKey);
  const rightKeys = column(right, rightKey);
  const leftMap = new Map<string, number>();
  const rightMap = new Map<string, number>();
  leftKeys.forEach((value, row) => { const key = finiteKey(value); if (key !== null && !leftMap.has(key)) leftMap.set(key, row); });
  rightKeys.forEach((value, row) => { const key = finiteKey(value); if (key !== null && !rightMap.has(key)) rightMap.set(key, row); });
  const keys = mode === "left"
    ? [...leftMap.keys()]
    : mode === "right"
      ? [...rightMap.keys()]
      : mode === "inner"
        ? [...leftMap.keys()].filter((key) => rightMap.has(key))
        : [...leftMap.keys(), ...[...rightMap.keys()].filter((key) => !leftMap.has(key))];
  // Same ascending-x invariant unstack restores above: Map keys iterate in
  // SOURCE-ROW order, and `full` appends every right-only key AFTER all left
  // keys regardless of value. Either way an unsorted key column (or a right
  // side holding lower keys) emitted a non-monotonic x, which uPlot reads as
  // the axis max and renders as a collapsed range. Sort numerically.
  keys.sort((a, b) => Number(a) - Number(b));
  const leftChannels = left.labels.map((_, i) => i).filter((i) => i !== leftKey);
  const rightChannels = right.labels.map((_, i) => i).filter((i) => i !== rightKey);
  const leftNames = new Set(leftChannels.map((i) => left.labels[i]));
  return {
    time: keys.map(Number),
    values: keys.map((key) => {
      const li = leftMap.get(key);
      const ri = rightMap.get(key);
      return [
        ...leftChannels.map((channel) => li === undefined ? Number.NaN : left.values[li]?.[channel] ?? Number.NaN),
        ...rightChannels.map((channel) => ri === undefined ? Number.NaN : right.values[ri]?.[channel] ?? Number.NaN),
      ];
    }),
    labels: [
      ...leftChannels.map((i) => left.labels[i]),
      ...rightChannels.map((i) => leftNames.has(right.labels[i]) ? `Right: ${right.labels[i]}` : right.labels[i]),
    ],
    units: [...leftChannels.map((i) => left.units[i] ?? ""), ...rightChannels.map((i) => right.units[i] ?? "")],
    metadata: {
      worksheet_transform: "join",
      join_mode: mode,
      left_metadata: left.metadata,
      right_metadata: right.metadata,
    },
  };
}
