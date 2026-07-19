import type { DataStruct } from "./types";

export type JoinMode = "inner" | "left" | "right" | "full";
export type AggregateMode = "mean" | "first" | "last";

const column = (ds: DataStruct, key: number): number[] =>
  key < 0 ? ds.time : ds.values.map((row) => row[key]);

function finiteKey(value: number): string | null {
  return Number.isFinite(value) ? String(value) : null;
}

function provenance(ds: DataStruct, operation: string): Record<string, unknown> {
  return { ...ds.metadata, worksheet_transform: operation };
}

/** Transpose the numeric Y matrix. The new X is the original channel index;
 * each original row becomes one output channel. Original schema is retained in
 * metadata because per-column units cannot be represented after transposition. */
export function transposeWorksheet(ds: DataStruct): DataStruct {
  const rows = ds.values.length;
  const channels = ds.labels.length;
  if (rows > 2_000) throw new Error("Transpose would create more than 2,000 output columns; filter or subset rows first");
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
  const cells = new Map<string, number[]>();
  for (let i = 0; i < keys.length; i += 1) {
    const key = finiteKey(keys[i]);
    const category = finiteKey(categories[i]);
    if (key === null || category === null || !Number.isFinite(values[i])) continue;
    if (!keySeen.has(key)) { keySeen.add(key); keyOrder.push(keys[i]); }
    if (!categorySeen.has(category)) { categorySeen.add(category); categoryOrder.push(categories[i]); }
    const cell = `${key}\u0000${category}`;
    cells.set(cell, [...(cells.get(cell) ?? []), values[i]]);
  }
  const pick = (items: number[]): number => {
    if (!items.length) return Number.NaN;
    if (aggregate === "first") return items[0];
    if (aggregate === "last") return items[items.length - 1];
    return items.reduce((sum, value) => sum + value, 0) / items.length;
  };
  if (categoryOrder.length > 2_000) {
    throw new Error("Unstack would create more than 2,000 output columns; reduce category levels first");
  }
  return {
    time: keyOrder,
    values: keyOrder.map((key) => categoryOrder.map((category) => pick(cells.get(`${key}\u0000${category}`) ?? []))),
    labels: categoryOrder.map((category) => `Category ${category}`),
    units: categoryOrder.map(() => valueColumn < 0 ? "" : (ds.units[valueColumn] ?? "")),
    metadata: { ...provenance(ds, "unstack"), unstack_aggregate: aggregate },
  };
}

/** Exact numeric key join. Duplicate keys retain their first row, making the
 * operation deterministic and preventing an accidental many-to-many explosion. */
export function joinWorksheets(
  left: DataStruct,
  right: DataStruct,
  leftKey: number,
  rightKey: number,
  mode: JoinMode = "inner",
): DataStruct {
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
