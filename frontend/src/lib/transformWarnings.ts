// Transform safety analysis (audit P2.5 — "Warnings for duplicate keys, unit
// mismatch, or row loss"). One pure analyzer per combine/reshape operation:
// each takes the SAME inputs the operation itself takes and returns the plain-
// language warnings a user should see BEFORE the derived dataset is created.
//
// Pure (no React / store / fetch). The analyzers re-derive their counts from
// the inputs rather than instrumenting the transforms, so the transforms in
// `lib/worksheetTransforms.ts` / `lib/merge.ts` / `calc.aggregate` stay
// untouched and the counts can be unit-tested against hand-computed fixtures.
// Every count here is pinned to the transform's own semantics — where they
// could drift (join's first-row-wins, algebra's NaN-outside-B's-range), the
// tests run the transform too and check the row accounting adds up.
//
// A warning with `confirm: true` is a UNIT mismatch: the dialogs must not let
// it through on a plain "OK" — they ask for an explicit confirm naming it.

import type { DataStruct } from "./types";
import type { AggregateMode, JoinMode } from "./worksheetTransforms";

export type TransformWarningCode =
  | "duplicate-keys"
  | "blank-keys"
  | "unmatched-dropped"
  | "unmatched-blank"
  | "unit-mismatch"
  | "label-mismatch"
  | "out-of-range"
  | "missing-split-key"
  | "units-dropped"
  | "aggregated"
  | "rows-dropped"
  // Resample / align (calc.resample_align, sent by the backend):
  | "duplicate-x"
  | "blank-values"
  | "blank-output"
  | "reordered";

export interface TransformWarning {
  code: TransformWarningCode;
  /** One plain sentence, shown verbatim in the review dialog and stamped into
   *  the derived dataset's metadata. */
  text: string;
  /** The row/cell/key count the sentence is about, when there is one. */
  count?: number;
  /** Affected column names. */
  columns?: string[];
  /** True for a unit mismatch — needs an explicit confirm, not a plain OK. */
  confirm?: boolean;
  /** True for an expected consequence the user already chose (a full join's
   *  blank cells, a transpose dropping units): recorded, never prompted for. */
  info?: boolean;
}

/** Display name of a `-1 = X, 0.. = channel` column. */
export function columnName(ds: DataStruct, key: number): string {
  if (key < 0) return String(ds.metadata?.x_column_name ?? "") || "X";
  return ds.labels[key] || `column ${key + 1}`;
}

/** Unit of a `-1 = X, 0.. = channel` column ("" when unknown). */
export function columnUnitOf(ds: DataStruct, key: number): string {
  const raw = key < 0 ? ds.metadata?.x_column_unit : ds.units[key];
  return typeof raw === "string" ? raw.trim() : "";
}

/** Two units conflict only when BOTH are known and differ. An empty unit is
 *  "not recorded", not a different unit — flagging every unit-less column
 *  against a labelled one would bury the real mismatches. */
function unitsConflict(a: string, b: string): boolean {
  return a !== "" && b !== "" && a !== b;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

const keyColumn = (ds: DataStruct, key: number): number[] =>
  key < 0 ? ds.time : ds.values.map((row) => row[key]);

interface KeySide {
  rows: number;
  blank: number;
  duplicateRows: number;
  duplicateKeys: number;
  /** Distinct finite keys, first-appearance order (the join's own map). */
  keys: Set<number>;
}

function keySide(values: readonly number[]): KeySide {
  // levels-allowlist: a JOIN KEY's distinct values (for duplicate/unmatched
  // counts), not a categorical column's level set; order is never used.
  const keys = new Set<number>();
  const dupKeys = new Set<number>();
  let blank = 0;
  let duplicateRows = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) { blank += 1; continue; }
    // `String(v)` is what the join keys on, and it merges -0 with 0 exactly
    // as a Set of numbers does — the two agree on what one key is.
    if (keys.has(v)) { duplicateRows += 1; dupKeys.add(v); } else keys.add(v);
  }
  return { rows: values.length, blank, duplicateRows, duplicateKeys: dupKeys.size, keys };
}

/** Warnings for `joinWorksheets(left, right, leftKey, rightKey, mode)`.
 *  Row accounting per side: every source row is either KEPT (first row of a
 *  key that survives the mode), a later duplicate of a kept key, blank-keyed,
 *  or unmatched-and-dropped by the mode. */
export function analyzeJoin(
  left: DataStruct,
  right: DataStruct,
  leftKey: number,
  rightKey: number,
  mode: JoinMode,
  leftName: string,
  rightName: string,
): TransformWarning[] {
  const out: TransformWarning[] = [];
  const l = keySide(keyColumn(left, leftKey));
  const r = keySide(keyColumn(right, rightKey));
  const lCol = columnName(left, leftKey);
  const rCol = columnName(right, rightKey);
  const lUnit = columnUnitOf(left, leftKey);
  const rUnit = columnUnitOf(right, rightKey);
  if (unitsConflict(lUnit, rUnit)) {
    out.push({
      code: "unit-mismatch",
      text: `Key units differ: "${lCol}" is ${lUnit} in ${leftName} but "${rCol}" is ${rUnit} in ${rightName}. Keys are matched as raw numbers, so rows may pair up wrongly.`,
      columns: [lCol, rCol],
      confirm: true,
    });
  }
  for (const [side, name, col] of [[l, leftName, lCol], [r, rightName, rCol]] as const) {
    if (side.duplicateRows) {
      out.push({
        code: "duplicate-keys",
        text: `${name}: ${plural(side.duplicateRows, "row")} ${side.duplicateRows === 1 ? "repeats" : "repeat"} an earlier key (${plural(side.duplicateKeys, "duplicated key value")} in "${col}"); only the first row of each key is kept.`,
        count: side.duplicateRows,
        columns: [col],
      });
    }
    if (side.blank) {
      out.push({
        code: "blank-keys",
        text: `${name}: ${plural(side.blank, "row")} with a blank or non-numeric "${col}" cannot match anything and ${side.blank === 1 ? "is" : "are"} dropped.`,
        count: side.blank,
        columns: [col],
      });
    }
  }
  const lOnly = [...l.keys].filter((k) => !r.keys.has(k)).length;
  const rOnly = [...r.keys].filter((k) => !l.keys.has(k)).length;
  const dropsLeft = mode === "inner" || mode === "right";
  const dropsRight = mode === "inner" || mode === "left";
  for (const [n, drops, name, other] of [
    [lOnly, dropsLeft, leftName, rightName],
    [rOnly, dropsRight, rightName, leftName],
  ] as const) {
    if (!n) continue;
    out.push(drops
      ? {
          code: "unmatched-dropped",
          text: `${name}: ${plural(n, "key value")} ${n === 1 ? "has" : "have"} no match in ${other}; ${n === 1 ? "its row is" : "their rows are"} dropped by the ${mode} join.`,
          count: n,
        }
      : {
          code: "unmatched-blank",
          info: true,
          text: `${name}: ${plural(n, "key value")} ${n === 1 ? "has" : "have"} no match in ${other}; ${other}'s columns stay blank there.`,
          count: n,
        });
  }
  return out;
}

/** Warnings for `stackWorksheet(ds, channels)`: stacking channels whose units
 *  differ writes them all into ONE Value column (units "mixed"). */
export function analyzeStack(ds: DataStruct, channels: readonly number[]): TransformWarning[] {
  const picked = [...new Set(channels)].filter((c) => c >= 0 && c < ds.labels.length);
  const units = new Map<string, string[]>();
  for (const c of picked) {
    const u = columnUnitOf(ds, c);
    if (!u) continue;
    units.set(u, [...(units.get(u) ?? []), columnName(ds, c)]);
  }
  if (units.size < 2) return [];
  const parts = [...units].map(([u, cols]) => `${cols.join(", ")} in ${u}`);
  return [{
    code: "unit-mismatch",
    text: `Stacked channels have different units (${parts.join("; ")}); the single Value column will mix them.`,
    columns: [...units.values()].flat(),
    confirm: true,
  }];
}

/** Warnings for `unstackWorksheet(ds, key, category, value, aggregate)`. */
export function analyzeUnstack(
  ds: DataStruct,
  key: number,
  category: number,
  value: number,
  aggregate: AggregateMode,
): TransformWarning[] {
  const out: TransformWarning[] = [];
  const keys = keyColumn(ds, key);
  const cats = keyColumn(ds, category);
  const vals = keyColumn(ds, value);
  const hits = new Map<string, number>();
  let dropped = 0;
  for (let i = 0; i < keys.length; i += 1) {
    if (!Number.isFinite(keys[i]) || !Number.isFinite(cats[i]) || !Number.isFinite(vals[i])) {
      dropped += 1;
      continue;
    }
    const cell = `${String(keys[i])}\u0000${String(cats[i])}`;
    hits.set(cell, (hits.get(cell) ?? 0) + 1);
  }
  if (dropped) {
    out.push({
      code: "rows-dropped",
      text: `${plural(dropped, "row")} with a blank key, category or value ${dropped === 1 ? "is" : "are"} dropped.`,
      count: dropped,
      columns: [columnName(ds, key), columnName(ds, category), columnName(ds, value)],
    });
  }
  let cells = 0;
  let merged = 0;
  for (const n of hits.values()) if (n > 1) { cells += 1; merged += n; }
  if (cells) {
    const rule = aggregate === "mean" ? "averaged" : `reduced to the ${aggregate} row`;
    out.push({
      code: "aggregated",
      text: `${plural(cells, "key/category cell")} ${cells === 1 ? "holds" : "hold"} several rows (${merged} rows in all); each is ${rule}.`,
      count: merged,
    });
  }
  return out;
}

/** Warnings for `transposeWorksheet(ds)`: per-column units cannot survive. */
export function analyzeTranspose(ds: DataStruct): TransformWarning[] {
  const withUnits = ds.labels.map((_, c) => c).filter((c) => columnUnitOf(ds, c) !== "");
  if (!withUnits.length) return [];
  return [{
    code: "units-dropped",
    info: true,
    text: `${plural(withUnits.length, "column unit")} cannot be carried through a transpose; the original units are kept in provenance only.`,
    count: withUnits.length,
    columns: withUnits.map((c) => columnName(ds, c)),
  }];
}

/** Warnings for `mergeDatasets(datasets, names)` — an APPEND BY POSITION, so
 *  column k of every input lands in column k of the result under the FIRST
 *  input's name and unit. A differing unit is a real mismatch; a differing
 *  name is the tell that positions may not line up. */
export function analyzeMerge(datasets: readonly DataStruct[], names: readonly string[]): TransformWarning[] {
  const out: TransformWarning[] = [];
  if (datasets.length < 2) return out;
  const first = datasets[0];
  const unitNotes: string[] = [];
  const unitCols = new Set<string>();
  const labelNotes: string[] = [];
  const labelCols = new Set<string>();
  const xUnit = columnUnitOf(first, -1);
  for (let i = 1; i < datasets.length; i += 1) {
    const d = datasets[i];
    const dx = columnUnitOf(d, -1);
    if (unitsConflict(xUnit, dx)) {
      unitNotes.push(`X is ${xUnit} in ${names[0]} but ${dx} in ${names[i]}`);
      unitCols.add(columnName(first, -1));
    }
    const n = Math.min(first.labels.length, d.labels.length);
    for (let c = 0; c < n; c += 1) {
      const a = columnUnitOf(first, c);
      const b = columnUnitOf(d, c);
      const col = columnName(first, c);
      if (unitsConflict(a, b)) {
        unitNotes.push(`"${col}" is ${a} in ${names[0]} but ${b} in ${names[i]}`);
        unitCols.add(col);
      }
      const la = (first.labels[c] ?? "").trim();
      const lb = (d.labels[c] ?? "").trim();
      if (la && lb && la.toLowerCase() !== lb.toLowerCase()) {
        labelNotes.push(`column ${c + 1} is "${la}" in ${names[0]} but "${lb}" in ${names[i]}`);
        labelCols.add(col);
      }
    }
  }
  if (unitNotes.length) {
    out.push({
      code: "unit-mismatch",
      text: `Units differ at the same column position: ${unitNotes.join("; ")}. Rows are appended by position and keep ${names[0]}'s units.`,
      count: unitNotes.length,
      columns: [...unitCols],
      confirm: true,
    });
  }
  if (labelNotes.length) {
    out.push({
      code: "label-mismatch",
      text: `Column names differ at the same position: ${labelNotes.join("; ")}. Rows are appended by position and keep ${names[0]}'s names.`,
      count: labelNotes.length,
      columns: [...labelCols],
    });
  }
  return out;
}

/** Operations whose result is only meaningful when A and B share a Y unit
 *  (`calc.aggregate.dataset_algebra` labels A+B / A-B with A's unit). */
const SAME_UNIT_OPS = new Set(["A+B", "A-B", "(A-B)/(A+B)"]);

/** Warnings for `dataset_algebra(a, b, operation)` (B interpolated onto A's
 *  x, NaN outside B's range — `calc.resample._interp_column` with
 *  extrapolate=False over B's finite (x, y) pairs). */
export function analyzeAlgebra(
  a: DataStruct,
  b: DataStruct,
  operation: string,
  nameA: string,
  nameB: string,
  channelA = 0,
  channelB = 0,
): TransformWarning[] {
  const out: TransformWarning[] = [];
  const xa = columnUnitOf(a, -1);
  const xb = columnUnitOf(b, -1);
  if (unitsConflict(xa, xb)) {
    out.push({
      code: "unit-mismatch",
      text: `X units differ: ${nameA} is in ${xa} but ${nameB} is in ${xb}. B is interpolated onto A's x as raw numbers, so points pair up at the wrong x.`,
      columns: [columnName(a, -1), columnName(b, -1)],
      confirm: true,
    });
  }
  const ya = columnUnitOf(a, channelA);
  const yb = columnUnitOf(b, channelB);
  if (unitsConflict(ya, yb)) {
    const cols = [columnName(a, channelA), columnName(b, channelB)];
    // The unit label calc.aggregate.dataset_algebra writes for each op.
    const label =
      operation === "A*B" ? `${ya}²` : operation === "A/B" ? "ratio" : operation === "(A-B)/(A+B)" ? "asymmetry" : ya;
    out.push(SAME_UNIT_OPS.has(operation)
      ? {
          code: "unit-mismatch",
          text: `Y units differ: "${cols[0]}" is ${ya} but "${cols[1]}" is ${yb}; ${operation} of different units is not meaningful (the result is labelled "${label}").`,
          columns: cols,
          confirm: true,
        }
      : {
          code: "label-mismatch",
          text: `Y units differ ("${cols[0]}" is ${ya}, "${cols[1]}" is ${yb}); the result is labelled "${label}", which does not reflect ${yb}.`,
          columns: cols,
        });
  }
  // B's usable support: the DISTINCT x of its finite (x, y) pairs — the
  // backend (`calc.resample._sanitize_xy`) drops non-finite pairs and
  // averages repeated x into one point before interpolating, so two rows at
  // the same x are one point, not two.
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  // levels-allowlist: distinct interpolation abscissae, not category levels.
  const xs = new Set<number>();
  b.time.forEach((x, i) => {
    const y = b.values[i]?.[channelB];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    xs.add(x);
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  });
  const usable = xs.size;
  const n = a.time.length;
  if (usable < 2) {
    if (n) {
      out.push({
        code: "out-of-range",
        text: `${nameB} has ${plural(usable, "usable point")} — at least 2 are needed to interpolate, so every result row (${n}) is blank.`,
        count: n,
      });
    }
    return out;
  }
  let outside = 0;
  for (const x of a.time) if (!Number.isFinite(x) || x < lo || x > hi) outside += 1;
  if (outside) {
    out.push({
      code: "out-of-range",
      text: `${outside} of ${n} rows of ${nameA} lie outside ${nameB}'s x-range [${lo}, ${hi}] (or have a blank x) and come out blank.`,
      count: outside,
      columns: [columnName(a, -1)],
    });
  }
  return out;
}

/** Warnings for a split (`lib/datasetsplit.splitColumn`): rows whose split
 *  value is blank collect into the trailing "(other)" group. */
export function analyzeSplit(
  groups: readonly { value: number; rowIndexes: readonly number[] }[],
  column: string,
): TransformWarning[] {
  const other = groups.find((g) => Number.isNaN(g.value));
  const n = other?.rowIndexes.length ?? 0;
  if (!n) return [];
  return [{
    code: "missing-split-key",
    text: `${plural(n, "row")} ${n === 1 ? "has" : "have"} no value in "${column}" and ${n === 1 ? "goes" : "go"} to a separate "(other)" dataset.`,
    count: n,
    columns: [column],
  }];
}

/** The warnings worth stopping for (everything but `info`). */
export function actionable(warnings: readonly TransformWarning[]): TransformWarning[] {
  return warnings.filter((w) => !w.info);
}

/** True when any warning needs an explicit (named) confirm. */
export function needsConfirm(warnings: readonly TransformWarning[]): boolean {
  return warnings.some((w) => w.confirm);
}

/** One line per warning, for the review dialog body. */
export function warningsText(summary: string, warnings: readonly TransformWarning[]): string {
  return [summary, ...warnings.map((w) => `• ${w.text}`)].join("\n");
}

/** Stamp the analysis into the derived dataset's metadata, beside its
 *  `worksheet_transform` provenance. Always written — an empty list records
 *  "checked, nothing found", which is different from "never checked". Plain
 *  strings, so the Inspector's metadata card reads them as sentences. */
export function stampWarnings(
  data: DataStruct,
  operation: string,
  warnings: readonly TransformWarning[],
): DataStruct {
  return {
    ...data,
    metadata: {
      ...data.metadata,
      // Always THIS operation: a merge/split inherits the first input's
      // metadata, whose own `worksheet_transform` describes an older step.
      worksheet_transform: operation,
      transform_warnings: warnings.map((w) => w.text),
    },
  };
}
