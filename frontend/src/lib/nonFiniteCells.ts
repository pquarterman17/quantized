// BUG-017: the NaN/±Infinity/-0 boundary for every JSON-serialized
// `DataStruct` numeric cell.
//
// `JSON.stringify` has no literal for a non-finite number — it writes `NaN`,
// `Infinity` and `-Infinity` all as `null`, and writes `-0` as `0`. Both
// losses were reachable from ordinary use: `store/cellEdit.ts`'s `insertRows`
// mints `Number.NaN` in every cell of a blank inserted row, a computed column
// can produce `NaN`/`±Infinity` from a sqrt/log/divide, and several parsers
// use `NaN` for a gap. Saving such a dataset wrote `null`s, and
// `lib/workspaceDatasetParse.ts`'s cell check rejected them — so the dataset
// threw on reopen and took the WHOLE workspace down with it. `-0` did not
// throw but silently became `+0`, which is enough to move
// `lib/peakTableFit.ts`'s `peakDataFingerprint` (it hashes each cell's raw
// float64 bits, and -0/+0 differ there) and discard an otherwise-valid saved
// peak-table fit on reopen.
//
// THE ENCODING. A non-finite (or negative-zero) cell is written as the STRING
// `String(value)` gives for it — `"NaN"`, `"Infinity"`, `"-Infinity"`, `"-0"`
// — and read back to the exact same value. Four properties make this safe:
//
//   1. NO COLLISION. These sentinels only ever appear inside a DataStruct's
//      `time` / `values` arrays, which are numeric by contract: a string cell
//      there has never been legal (the pre-fix cell check accepted `typeof x
//      === "number"` and nothing else). Text data lives in the row sidecars
//      under `metadata` (lib/rowSidecars.ts), never in `values`, so a real
//      string cell reading "NaN" cannot exist to be confused with one.
//   2. NO OUTPUT CHANGE FOR ORDINARY DATA. `encodeCells`/`encodeDataStruct`
//      return the INPUT array/object by reference when nothing needs a
//      sentinel, so a `.dwk` with only finite cells serializes byte-for-byte
//      as it did before this module existed. No schema/version bump: the
//      format only gains a shape it could never previously hold.
//   3. OLD DOCUMENTS ARE UNTOUCHED. A pre-fix `.dwk` has no sentinels, so
//      `decodeDataStruct` returns it by reference and it parses exactly as
//      before. A pre-fix `null` cell stays a REJECTION (see the decision note
//      in `lib/workspaceDatasetParse.ts`): `null` is ambiguous — it could
//      have been NaN, +Infinity or -Infinity, and it is also what genuinely
//      corrupt input looks like — so this module never guesses at one.
//   4. AN OLD BUILD FAILS LOUDLY, NOT SILENTLY. A build without this module
//      reading a `.dwk` WITH sentinels runs the old `typeof x === "number"`
//      check, which a string fails, and reports `dataset N ("name") has an
//      invalid data structure` — the same clear refusal it already gave for
//      that dataset before this fix, never a silently wrong number.

import type { Dataset, DataStruct } from "./types";

/** A `DataStruct` cell as it appears in JSON: a finite number, or one of the
 *  four sentinel strings for the values JSON cannot represent. */
export type WireCell = number | "NaN" | "Infinity" | "-Infinity" | "-0";

/** A `DataStruct` as it appears in JSON — identical except that `time` and
 *  `values` hold `WireCell`s. Every other field (labels/units/metadata/
 *  cat_levels/…) is written and read verbatim, exactly as before. */
export type WireDataStruct = Omit<DataStruct, "time" | "values"> & {
  time: readonly WireCell[];
  values: readonly (readonly WireCell[])[];
};

/** A `Dataset` as it appears in JSON — only its two DataStruct-valued fields
 *  differ from the in-memory type. */
export type WireDataset = Omit<Dataset, "data" | "raw"> & {
  data: WireDataStruct;
  raw?: WireDataStruct;
};

/** Does this cell survive `JSON.stringify` unchanged? `-0` does not (it
 *  writes as `0`), which is why it is checked separately from finiteness. */
function needsSentinel(v: number): boolean {
  return !Number.isFinite(v) || Object.is(v, -0);
}

export function encodeCell(v: number): WireCell {
  if (Number.isNaN(v)) return "NaN";
  if (v === Infinity) return "Infinity";
  if (v === -Infinity) return "-Infinity";
  return Object.is(v, -0) ? "-0" : v;
}

export function decodeCell(v: WireCell): number {
  if (typeof v === "number") return v;
  if (v === "NaN") return Number.NaN;
  if (v === "Infinity") return Infinity;
  if (v === "-Infinity") return -Infinity;
  return -0;
}

/** Is `v` a legal serialized cell array — every element a number or one of
 *  the four sentinels? This is the widened form of the `isNumberArray` check
 *  `lib/workspaceDatasetParse.ts` used to carry; `null` and every other
 *  string still fail it, so genuinely malformed data is still rejected. */
export function isWireCellArray(v: unknown): v is WireCell[] {
  return (
    Array.isArray(v) &&
    v.every(
      (x) =>
        typeof x === "number" ||
        x === "NaN" ||
        x === "Infinity" ||
        x === "-Infinity" ||
        x === "-0",
    )
  );
}

/** Encode one numeric row. Returns `row` ITSELF when every cell is a finite,
 *  non-negative-zero number — property 2 in the module header. */
export function encodeCells(row: readonly number[]): readonly WireCell[] {
  return row.some(needsSentinel) ? row.map(encodeCell) : row;
}

/** Decode one serialized row. Returns `row` ITSELF when it holds no
 *  sentinels, so a pre-fix document is handed on untouched. */
export function decodeCells(row: readonly WireCell[]): number[] {
  return row.some((c) => typeof c !== "number")
    ? row.map(decodeCell)
    : (row as number[]);
}

/** Encode a DataStruct's `time` and `values` for JSON. Returns `d` itself
 *  when nothing needed a sentinel. */
export function encodeDataStruct(d: DataStruct): WireDataStruct {
  const time = encodeCells(d.time);
  let changed = time !== d.time;
  const values = d.values.map((row) => {
    const encoded = encodeCells(row);
    if (encoded !== row) changed = true;
    return encoded;
  });
  return changed ? { ...d, time, values } : d;
}

/** Decode a serialized DataStruct's cells. Returns `d` itself (cast — the
 *  arrays are already plain numbers) when it carries no sentinels. */
export function decodeDataStruct(d: WireDataStruct): DataStruct {
  const time = decodeCells(d.time);
  let changed = time !== d.time;
  const values = d.values.map((row) => {
    const decoded = decodeCells(row);
    if (decoded !== row) changed = true;
    return decoded;
  });
  return changed ? { ...d, time, values } : (d as DataStruct);
}

/** Encode a whole dataset's numeric payload — its `data` and, when present,
 *  its base-only `raw`. Returns `d` itself when neither needed a sentinel, so
 *  a package/document of ordinary data is byte-identical to before. */
export function encodeDatasetCells(d: Dataset): WireDataset {
  const data = encodeDataStruct(d.data);
  const raw = d.raw === undefined ? undefined : encodeDataStruct(d.raw);
  if (data === d.data && raw === d.raw) return d as WireDataset;
  return { ...d, data, ...(raw === undefined ? {} : { raw }) };
}
