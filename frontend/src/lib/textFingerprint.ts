// The text-cell half of a worksheet's analysis fingerprint.
//
// The numeric hash (`dataFingerprint`) and the schema hash cover values, labels
// and categorical levels, but not the row-indexed text sidecars
// (`metadata.text_columns` / `origin_text_columns`). A result grouped or
// labelled by a text column therefore stayed "Current" after a text cell
// changed (#1237 found this). `analysisDataFingerprint` now appends
// `~t<8 hex>` when a sheet has a text sidecar; a sheet without one hashes
// exactly as before, so its saved results are untouched.
//
// Saved-before compatibility: a fingerprint recorded before this change has no
// `~t` segment even on a sheet that has text. `sameFingerprint` compares such a
// stored value against the current one with the segments removed (the old
// formula), so a file does not turn stale on load merely because the formula
// grew. The price is honest: a legacy result cannot see a text edit until it is
// run again.

import { dataFingerprint } from "./dataFingerprint";
import type { DataStruct } from "./types";

const SEGMENT = /~t[0-9a-f]{8}/g;
const cache = new WeakMap<object, string>();

/** `~t<hash>` of the sheet's text sidecars, or "" when it has none. */
export function textFingerprint(metadata: Record<string, unknown> | undefined): string {
  const keys = ["text_columns", "origin_text_columns"].map((k) => metadata?.[k]);
  if (!keys.some((raw) => raw && typeof raw === "object")) return "";
  const hit = cache.get(metadata!);
  if (hit !== undefined) return hit;
  const text = JSON.stringify(keys);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  const out = `~t${(h >>> 0).toString(16).padStart(8, "0")}`;
  cache.set(metadata!, out);
  return out;
}

/** Is `stored` (a persisted fingerprint) still the state `now` describes? A
 *  stored value with no text segment predates text hashing, so it is compared
 *  against `now` without its text segments. */
export function sameFingerprint(stored: string | null | undefined, now: string): boolean {
  return stored === now || (stored != null && !stored.includes("~t") && now.replace(SEGMENT, "") === stored);
}

/** The RAW source fingerprint: the numbers (`dataFingerprint`) plus the text
 *  segment. Used where a result records the worksheet it read (linked recalc
 *  outputs, a fit's freshness stamp). A sheet with no text sidecar returns
 *  exactly `dataFingerprint(data)`, so those records keep their value; compare
 *  a PERSISTED value with `sameFingerprint`. Cost over the numeric hash: one
 *  JSON.stringify of the sidecars per metadata object (cached), none per render. */
export function rawSourceFingerprint(data: DataStruct): string {
  return dataFingerprint(data) + textFingerprint(data.metadata);
}
