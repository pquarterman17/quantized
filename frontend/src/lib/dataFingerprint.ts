// A 64-bit content hash of a worksheet's numbers. Extracted from
// lib/analysisResultFreshness.ts (which re-exports it) so a figure document's
// saved analysis overlays (lib/figureOverlays.ts) can check the rows they align
// to without pulling the analysis-result freshness graph into the eager bundle.

import type { DataStruct } from "./types";

const fingerprints = new WeakMap<DataStruct, string>();
const scratch = new Float64Array(1);
const words = new Uint32Array(scratch.buffer);

/** A 64-bit content hash of a worksheet's numbers (X and every cell, with
 *  shape). Non-finite values and -0 are canonicalised because the .dwk JSON
 *  round trip does not preserve them, and a save/reopen must hash the same.
 *  Cached per `data` object, which every edit replaces. */
export function dataFingerprint(data: DataStruct): string {
  const cached = fingerprints.get(data);
  if (cached) return cached;
  let a = 0x811c9dc5;
  let b = 0x9747b28c;
  const mix = (value: unknown): void => {
    scratch[0] = typeof value === "number" && Number.isFinite(value) ? value + 0 : NaN;
    for (const word of words) {
      a = Math.imul(a ^ word, 0x01000193);
      b = Math.imul(b ^ word, 0x5bd1e995);
      b ^= b >>> 15;
    }
  };
  mix(data.time.length);
  for (const x of data.time) mix(x);
  mix(data.values.length);
  for (const row of data.values) {
    mix(row.length);
    for (const cell of row) mix(cell);
  }
  const out = `${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
  fingerprints.set(data, out);
  return out;
}
