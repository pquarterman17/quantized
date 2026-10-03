// The .dwk writer's per-dataset cell encoder (perf audit 2026-09-29). Autosave
// used to push EVERY cell of every dataset through the BUG-017 replacer
// (`encodePersistedCells`), pretty-printed, on the main thread 800 ms after any
// structural change: 4.3 s at 1M×8. Two savings, neither of which changes a
// byte of what the replacer writes for a DataStruct:
//
//   1. CACHE per `data` object identity. DataStructs are never mutated in
//      place — an edit mints a new object (store/cellEdit.ts; the same rule
//      lib/modeling.ts's WeakMap cache relies on) — so a dataset whose `data`
//      is unchanged costs one map lookup. The WeakMap lets a deleted dataset's
//      string go with it.
//   2. SKIP THE REPLACER for an array with no cell that needs a sentinel: it
//      goes through native `JSON.stringify`, which writes the same text.
//
// The rest of the DataStruct (labels/units/metadata/…) still goes through the
// replacer, so anything it encodes there is encoded exactly as before.

import { encodeDataCell, encodePersistedCells, type WireDataStruct } from "./nonFiniteCells";

const cache = new WeakMap<WireDataStruct, string>();

/** Would the replacer rewrite this cell? It sends every DataStruct cell to
 *  `encodeDataCell`, which changes only a null (-> "NaN"), a non-finite, a
 *  -0, or a non-number. */
function needsSentinel(c: unknown): boolean {
  return typeof c !== "number" || !Number.isFinite(c) || Object.is(c, -0);
}

function rowJson(row: readonly unknown[]): string {
  return JSON.stringify(row.some(needsSentinel) ? encodeRow(row) : row);
}

function encodeRow(row: readonly unknown[]): unknown[] {
  return row.map((c) => encodeDataCell(c as number | null));
}

// A per-page nonce keeps the splice markers from matching any user text.
const NONCE = Math.random().toString(36).slice(2);
const T = `@@qz-time-${NONCE}@@`;
const V = `@@qz-values-${NONCE}@@`;

function encode(data: WireDataStruct): string {
  const { time, values } = data as { time: unknown; values: unknown };
  // The replacer encodes cells only on a DataStruct that HAS metadata, and
  // anything malformed is left to it verbatim.
  if (!data.metadata || !Array.isArray(time) || !Array.isArray(values) || !values.every(Array.isArray)) {
    return JSON.stringify(data, encodePersistedCells);
  }
  const rows = values as unknown[][];
  const valuesJson = rows.some((r) => r.some(needsSentinel))
    ? JSON.stringify(rows.map((r) => (r.some(needsSentinel) ? encodeRow(r) : r)))
    : JSON.stringify(rows);
  // Same keys in the same order; only the two cell arrays are swapped out.
  const shell = JSON.stringify({ ...data, time: T, values: V }, encodePersistedCells);
  return shell.replace(`"${T}"`, () => rowJson(time)).replace(`"${V}"`, () => valuesJson);
}

/** `JSON.stringify(data, encodePersistedCells)`, byte for byte, cached per
 *  `data` object. */
export function dataStructJson(data: WireDataStruct): string {
  let json = cache.get(data);
  if (json === undefined) {
    json = encode(data);
    cache.set(data, json);
  }
  return json;
}

const CELLS = new RegExp(`"@@qz-cells-${NONCE}-(\\d+)@@"`, "g");

/** Stringify `doc` through the replacer with every DataStruct passed to `hole`
 *  spliced in, compact, from the cache. `build` receives `hole` and returns the
 *  document with each DataStruct replaced by `hole(ds)`. `space` indents only
 *  the document around the cells. */
export function stringifyWithCells(
  build: (hole: (ds: WireDataStruct | undefined) => string | undefined) => unknown,
  space?: number,
): string {
  const parts: string[] = [];
  const hole = (ds: WireDataStruct | undefined) =>
    ds === undefined ? undefined : `@@qz-cells-${NONCE}-${parts.push(dataStructJson(ds)) - 1}@@`;
  const text = JSON.stringify(build(hole), encodePersistedCells, space);
  return text.replace(CELLS, (_m, i: string) => parts[Number(i)]);
}
