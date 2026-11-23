// The row and struct halves of lib/nonFiniteCells.ts (bundle diet slice 32):
// encode and decode a whole row or DataStruct. Only the lazy `.dwk` parse and
// write (lib/workspaceDatasetParse.ts, lib/workspaceSerialize.ts) call them, so
// they ship with those; lib/nonFiniteCells.ts re-exports them with `export *`.
// The cell-level primitives stay there, which the eager figure code uses.

import {
  decodeCell,
  encodeCell,
  needsSentinel,
  type DataStructCells,
  type WireCell,
  type WireDataStruct,
} from "./nonFiniteCells";
import type { DataStruct } from "./types";

/** Is `v` a legal serialized cell array — every element a number or one of
 *  the four sentinels? This is the widened form of the `isNumberArray` check
 *  `lib/workspaceDatasetParse.ts` used to carry; `null` and every other
 *  string still fail it, so genuinely malformed data is still rejected. */
export function isWireCellArray(v: unknown): v is WireCell[] {
  return Array.isArray(v) && v.every((cell) => decodeCell(cell) !== undefined);
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
    ? row.map((cell) => decodeCell(cell))
    : (row as number[]);
}

function mapDataStruct<T extends WireCell, U extends WireCell>(
  d: DataStructCells<T>,
  transform: (row: readonly T[]) => readonly U[],
): DataStructCells<U> {
  const time = transform(d.time);
  let changed = time !== d.time as readonly unknown[];
  const values = d.values.map((row) => {
    const next = transform(row);
    if (next !== row as readonly unknown[]) changed = true;
    return next;
  });
  return changed ? { ...d, time, values } : d as unknown as DataStructCells<U>;
}

/** Encode a DataStruct's `time` and `values` for JSON. Returns `d` itself
 *  when nothing needed a sentinel. */
export function encodeDataStruct(d: DataStruct): WireDataStruct {
  return mapDataStruct(d, encodeCells);
}

/** Decode a serialized DataStruct's cells. Returns `d` itself (cast — the
 *  arrays are already plain numbers) when it carries no sentinels. */
export function decodeDataStruct(d: WireDataStruct): DataStruct {
  return mapDataStruct(d, decodeCells) as DataStruct;
}
