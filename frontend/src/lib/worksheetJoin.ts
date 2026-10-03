// Keyed join (audit P2.5 — "previewed ... keyed join"). Split out of
// `lib/worksheetTransforms.ts` when the key grew a TEXT form; that module
// re-exports `joinWorksheets` so its callers are unchanged.
//
// A key is `-1` (X), a channel index, or the NAME of a text sidecar column
// (`metadata.text_columns ?? origin_text_columns`, lib/columnmeta.ts). A
// categorical channel (one with a `cat_levels` table) keys by its LEVEL
// STRING, never its code: two datasets rarely number their levels alike, so
// matching codes would pair "B" in one with "C" in the other. That is the
// NEW ("text") key mode; the OLD ("code") one — how every step recorded
// before this feature existed still replays — keys a categorical channel by
// its raw numeric code instead, and never refuses a text-vs-numeric key
// pairing (that distinction did not exist yet). `lib/transformRun.ts`
// resolves a recorded step's `keyMode` (absent = "code") and passes it here;
// every direct/interactive call (tests included) defaults to "text".
//
// `joinKeyColumn` is the ONE place a key cell becomes a match string; the join
// itself and `analyzeJoin` (lib/transformWarnings.ts) both read it, so the
// warnings can never count keys the join treats differently.

import { categoricalLevels, labelForCode } from "./categorical";
import { originTextColumns, type TextColumn } from "./originTextColumns";
import { sidecarRowCount } from "./rowSidecars";
import type { DataStruct } from "./types";

export type JoinMode = "inner" | "left" | "right" | "full";
/** `-1` = X, `0..` = channel, a string = a text sidecar column's name. */
export type JoinKey = number | string;
/** "text" (current): a categorical channel keys by its level string, and a
 *  text-vs-numeric key pairing is refused. "code" (pre-P2.5): a categorical
 *  channel keys by its raw numeric code, and kinds are never checked. */
export type JoinKeyMode = "text" | "code";

export interface JoinKeyColumn {
  /** "text" for a text sidecar or a categorical channel keyed by level text,
   *  "number" otherwise. */
  kind: "number" | "text";
  /** Per source row: the string the join matches on, or null for a blank
   *  (non-finite number, missing level, empty text) — which matches nothing. */
  keys: (string | null)[];
}

/** A text cell as a key: trimmed ("S1 " from a spreadsheet export is "S1"),
 *  and blank = no key. Also the right answer for a cell past the end of a
 *  short sidecar array (`col.rows[i]` is `undefined` there): `undefined?.trim()`
 *  is `undefined`, so it falls through to `null` exactly like an empty string. */
const textKey = (s: string | null): string | null => s?.trim() || null;

/** `ds`'s own row count for anything that must align to it 1:1 — its numeric
 *  grid, or (a text-only book has no numeric grid at all — module doc) the
 *  longest of its row-indexed sidecars (`lib/rowSidecars.ts`'s
 *  `sidecarRowCount`, the same baseline `lib/merge.ts` uses per input). A
 *  text-sidecar KEY and every carried non-key text column both read against
 *  this, so a sidecar shorter than the dataset's real row count blanks its
 *  missing cells instead of silently shrinking the join to the sidecar's own
 *  length (review finding: rows past a short sidecar used to vanish from the
 *  join uncounted). */
function rowCountOf(ds: DataStruct): number {
  return sidecarRowCount(ds.metadata ?? {}, Math.max(ds.time.length, ds.values.length));
}

/** A column's display name / unit, for `-1` = X as for a channel. */
const nameOf = (ds: DataStruct, c: number): string =>
  c < 0 ? String(ds.metadata?.x_column_name ?? "") || "X" : ds.labels[c];
const unitOf = (ds: DataStruct, c: number): string => {
  const u = c < 0 ? ds.metadata?.x_column_unit : ds.units[c];
  return typeof u === "string" ? u : "";
};

/** The match strings of `key` in `ds`. Numbers key on `String(v)`, which
 *  merges -0 with 0 (as a Set of numbers does). Throws for a text column that
 *  does not exist. `keyMode` (module doc) only affects a CATEGORICAL channel
 *  key — a text-sidecar key is unaffected (it never existed under "code"). */
export function joinKeyColumn(ds: DataStruct, key: JoinKey, keyMode: JoinKeyMode = "text"): JoinKeyColumn {
  if (typeof key === "string") {
    const col = originTextColumns(ds).find((c) => c.shortName === key);
    if (!col) throw new Error(`there is no text column "${key}"`);
    const n = rowCountOf(ds);
    return { kind: "text", keys: Array.from({ length: n }, (_, i) => textKey(col.rows[i])) };
  }
  const levels = keyMode === "text" && key >= 0 ? categoricalLevels(ds, key) : null;
  const raw = key < 0 ? ds.time : ds.values.map((row) => row[key]);
  if (levels) return { kind: "text", keys: raw.map((code) => textKey(labelForCode(levels, code))) };
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

/** Every text sidecar column of `ds` EXCEPT the one used as `key` (already
 *  carried, as the join's key channel, when it is a text column). */
function carriableTextColumns(ds: DataStruct, key: JoinKey): TextColumn[] {
  return originTextColumns(ds).filter((c) => !(typeof key === "string" && c.shortName === key));
}

/** A carried text column's value at joined row `row` (its own source row,
 *  `undefined` when that side has no row for this key): blank ("") rather
 *  than dropped, matching every other row-indexed-sidecar reader's "a miss
 *  reads as blank" convention (`lib/rowSidecars.ts`'s `sliceCells`). */
const carriedCell = (col: TextColumn, row: number | undefined): string => (row === undefined ? "" : col.rows[row] ?? "");

export interface CarriedTextColumn {
  /** The output column name — the source name, or (finding 1: "like numeric
   *  channels") "Right: <name>" when the right side's own name collides with
   *  a left one. */
  name: string;
  side: "left" | "right";
  /** The source column's OWN name, before any "Right: " suffix — what a
   *  "could not be carried" warning should name. */
  shortName: string;
  col: TextColumn;
}

export interface CarriedTextPlan {
  kept: CarriedTextColumn[];
  /** A column whose (possibly L/R-suffixed) output name still collided with
   *  an earlier one — e.g. right already has its OWN "Right: A" column, and
   *  right's "A" was just suffixed to that same name. Two columns cannot
   *  share one output name, so this one is not carried; `analyzeJoin` warns
   *  about it BY NAME instead of the join silently overwriting one with the
   *  other. */
  dropped: CarriedTextColumn[];
}

/** What `joinWorksheets` would carry from each side's non-key text sidecar
 *  columns, and what it could not — shared with `analyzeJoin`
 *  (lib/transformWarnings.ts) so the two never disagree on what got carried
 *  vs. dropped. Pure: takes only the two keys, not the join's mode/rows. */
export function planCarriedText(left: DataStruct, right: DataStruct, leftKey: JoinKey, rightKey: JoinKey): CarriedTextPlan {
  const leftCarry = carriableTextColumns(left, leftKey);
  const rightCarry = carriableTextColumns(right, rightKey);
  const leftNames = new Set(leftCarry.map((c) => c.shortName));
  const candidates: CarriedTextColumn[] = [
    ...leftCarry.map((col): CarriedTextColumn => ({ name: col.shortName, side: "left", shortName: col.shortName, col })),
    ...rightCarry.map((col): CarriedTextColumn => ({
      name: leftNames.has(col.shortName) ? `Right: ${col.shortName}` : col.shortName,
      side: "right",
      shortName: col.shortName,
      col,
    })),
  ];
  const seen = new Set<string>();
  const kept: CarriedTextColumn[] = [];
  const dropped: CarriedTextColumn[] = [];
  for (const c of candidates) {
    if (seen.has(c.name)) dropped.push(c);
    else {
      seen.add(c.name);
      kept.push(c);
    }
  }
  return { kept, dropped };
}

/** Exact key join. Duplicate keys retain their first row, making the
 *  operation deterministic and preventing an accidental many-to-many
 *  explosion. Rows whose key is blank are excluded on that side — a blank key
 *  cannot match anything — so a `left` join keeps every left row that HAS a
 *  key, not literally every left row.
 *
 *  A NUMERIC key becomes the output X, sorted ascending. A TEXT key cannot be
 *  an X, so the output X is a 1-based row number (matching every other Row
 *  axis in the app), the key is the first channel, categorical, in
 *  first-appearance order (left keys, then right-only ones), and each side's
 *  own X follows as an ordinary column rather than being lost. Every other
 *  channel keeps its own side's level table. Every non-key TEXT SIDECAR
 *  column on either side is carried into the result too, row-aligned to the
 *  joined rows and blank where a side has no row for that key; a name both
 *  sides use gets the same L/R suffix a colliding numeric channel gets. */
export function joinWorksheets(
  left: DataStruct,
  right: DataStruct,
  leftKey: JoinKey,
  rightKey: JoinKey,
  mode: JoinMode = "inner",
  keyMode: JoinKeyMode = "text",
  // Review finding 5 (lib/transformPreviewCompute.ts): a live preview needs
  // only the first ~20 OUTPUT rows plus an honest "was this capped" signal —
  // never a Create/replay caller, which always omits this and gets the
  // exact result. Applied AFTER the full key list is built (that part is
  // O(input rows), already cheap) and BEFORE building `values`/`text_columns`
  // (the part that is O(output rows × columns) and the actual cost this
  // exists to avoid) — the join still knows every duplicate/unmatched key
  // exactly right, it just stops short of materializing every row.
  limit?: number,
): DataStruct {
  // Cheap upper-bound guard, before building any maps: a join's output can
  // never exceed left + right rows (full outer with disjoint keys). Refusing
  // on that bound keeps the "won't overwhelm the UI" contract without paying
  // to materialize a giant result first.
  if (left.time.length + right.time.length > 5_000_000) {
    throw new Error("Join would create more than 5,000,000 rows; filter or subset the inputs first");
  }
  const lk = joinKeyColumn(left, leftKey, keyMode);
  const rk = joinKeyColumn(right, rightKey, keyMode);
  // The kind-mismatch refusal is itself a "text" mode rule: "code" replay
  // never had the concept of a key's kind, so it never refused on it either.
  if (keyMode === "text" && lk.kind !== rk.kind) {
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
  // The exact full row count, BEFORE any preview truncation — cheap (the key
  // list above, not the per-row/per-column materialization below).
  const fullRowCount = keys.length;
  if (limit !== undefined && keys.length > limit) keys.length = limit;
  // Each joined row's own row on each side — computed ONCE, read by the
  // numeric channels below and by the carried text columns alike.
  const liOf = keys.map((key) => leftMap.get(key));
  const riOf = keys.map((key) => rightMap.get(key));
  // A text key takes the X's place, so each side's own X would be lost: it is
  // carried as an ordinary column (`-1` below) instead. A numeric key keeps
  // the long-standing shape — the key IS the new X, the other channels follow.
  const channelsOf = (ds: DataStruct, key: JoinKey) => [
    ...(text && key !== -1 ? [-1] : []),
    ...ds.labels.map((_, i) => i).filter((i) => i !== key),
  ];
  const leftChannels = channelsOf(left, leftKey);
  const rightChannels = channelsOf(right, rightKey);
  const leftNames = new Set(leftChannels.map((c) => nameOf(left, c)));
  const lead = text ? 1 : 0;
  const cat_levels: Record<number, string[]> = text && keys.length ? { 0: keys } : {};
  const level_order: Record<number, number[]> = {};
  const carry = (ds: DataStruct, channels: number[], offset: number) =>
    channels.forEach((c, j) => {
      const levels = c >= 0 ? categoricalLevels(ds, c) : null;
      if (levels) cat_levels[offset + j] = levels;
      const order = ds.level_order?.[c];
      if (levels && Array.isArray(order)) level_order[offset + j] = [...order];
    });
  carry(left, leftChannels, lead);
  carry(right, rightChannels, lead + leftChannels.length);
  const keyName = typeof leftKey === "string" ? leftKey : nameOf(left, leftKey) || "Key";
  const at = (ds: DataStruct, row: number | undefined, c: number): number =>
    row === undefined ? Number.NaN : ((c < 0 ? ds.time[row] : ds.values[row]?.[c]) ?? Number.NaN);
  // Non-key text sidecar columns, carried row-aligned to the joined rows
  // (finding 1: these used to be dropped, nested unreadably under
  // left_metadata/right_metadata instead). `analyzeJoin` runs the SAME plan
  // to warn about anything `dropped` names.
  const { kept: carriedText } = planCarriedText(left, right, leftKey, rightKey);
  const text_columns: Record<string, string[]> = {};
  for (const c of carriedText) {
    const rowOf = c.side === "left" ? liOf : riOf;
    text_columns[c.name] = rowOf.map((row) => carriedCell(c.col, row));
  }
  return {
    // A text key's Row axis is 1-based, like every other Row axis in the app
    // (finding 9 — it used to start at 0).
    time: text ? keys.map((_, k) => k + 1) : keys.map(Number),
    values: keys.map((_key, k) => [
      ...(text ? [k] : []),
      ...leftChannels.map((c) => at(left, liOf[k], c)),
      ...rightChannels.map((c) => at(right, riOf[k], c)),
    ]),
    labels: [
      ...(text ? [keyName] : []),
      ...leftChannels.map((c) => nameOf(left, c)),
      ...rightChannels.map((c) => (leftNames.has(nameOf(right, c)) ? `Right: ${nameOf(right, c)}` : nameOf(right, c))),
    ],
    units: [
      ...(text ? [""] : []),
      ...leftChannels.map((c) => unitOf(left, c)),
      ...rightChannels.map((c) => unitOf(right, c)),
    ],
    metadata: {
      worksheet_transform: "join",
      join_mode: mode,
      ...(text ? { join_key: "text", x_column_name: "Row" } : {}),
      left_metadata: left.metadata,
      right_metadata: right.metadata,
      ...(Object.keys(text_columns).length ? { text_columns } : {}),
      // A live-preview-only marker (finding 5): the true row count was
      // GREATER than `limit`, so this result is a truncated approximation.
      // Never set on a Create/replay call (no `limit` there) and never
      // stamped into a committed dataset.
      ...(limit !== undefined && fullRowCount > limit ? { preview_truncated_from: fullRowCount } : {}),
    },
    ...(Object.keys(cat_levels).length ? { cat_levels } : {}),
    ...(Object.keys(level_order).length ? { level_order } : {}),
  };
}
