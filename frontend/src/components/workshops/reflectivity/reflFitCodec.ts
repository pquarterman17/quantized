// Reflectivity fit — the JSON-safe codec and the read-side validators shared by
// the durable fit record (reflFitRecord.ts) and its posterior summary
// (reflPosterior.ts). Pure. Split out of reflFitRecord.ts (P2.2 slice 4) so
// both can use it without importing each other.
//
// `encodeCell`/`decodeCell` are lib/nonFiniteCells.ts's, RESTATED rather than
// imported, deliberately: that module is eager, and importing two of its
// functions from this lazy chunk makes the eager chunk export them — measured
// +22 B against an eager budget with no headroom (2026-09-24, vite build). The
// parity test in reflFitRecord.test.ts runs the real pair as the oracle over
// every sentinel, so a change to the codec fails there instead of drifting.

/** lib/nonFiniteCells.ts `encodeCell`: the sentinel for NaN/±Infinity/-0. */
export function encodeNum(v: number): number | string {
  if (Object.is(v, -0)) return "-0";
  return Number.isFinite(v) ? v : String(v);
}

/** lib/nonFiniteCells.ts `decodeCell`: a number or sentinel back to a number,
 *  undefined for anything else. */
export function decodeNum(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (v === "NaN") return Number.NaN;
  if (v === "Infinity") return Infinity;
  if (v === "-Infinity") return -Infinity;
  return v === "-0" ? -0 : undefined;
}

/** A deep, JSON-safe copy whose non-finite numbers (and -0) are the BUG-017
 *  sentinel strings — the stored form of a record or any part of one. */
export function encodeStored(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_k, v: unknown) => (typeof v === "number" ? encodeNum(v) : v)));
}

// ── read-side validators: each throws `Bad` on a value it cannot accept ─────

export type Obj = Record<string, unknown>;
export const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
export const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
/** A number, decoding the sentinels; undefined when it is neither. */
export const num = (v: unknown): number | undefined => decodeNum(v);
export const numOrNull = (v: unknown): number | null | undefined => (v === null ? null : num(v));
export const index = (v: unknown): number | null | undefined =>
  v === null ? null : Number.isInteger(v) && (v as number) >= 0 ? (v as number) : undefined;

export class Bad extends Error {}
export function need<T>(v: T | undefined | null, what: string): T {
  if (v === undefined || v === null) throw new Bad(what);
  return v;
}
export function needNullable<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new Bad(what);
  return v;
}
export function list<T>(v: unknown, item: (x: unknown) => T): T[] {
  if (!Array.isArray(v)) throw new Bad("list");
  return v.map(item);
}
export const oneOf = <T extends string>(v: unknown, options: readonly T[]): T => {
  if (!options.includes(v as T)) throw new Bad("enum");
  return v as T;
};
