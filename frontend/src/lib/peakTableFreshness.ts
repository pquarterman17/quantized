// Small, render-safe half of peakTableFit. The Library needs to show whether
// a durable peak table still describes its source, but importing the complete
// fitting/editing module into the Library would add that lazy feature to the
// startup bundle.

import type { PeakTable } from "./peakTable";
import { analysisData } from "./rowstate";
import type { Dataset } from "./types";

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnvFloat(h: number, view: DataView, value: number): number {
  view.setFloat64(0, value);
  let next = h;
  for (let i = 0; i < 8; i++) next = Math.imul(next ^ view.getUint8(i), FNV_PRIME) >>> 0;
  return next;
}

function fnvText(h: number, value: string): number {
  let next = h;
  for (let i = 0; i < value.length; i++) next = Math.imul(next ^ value.charCodeAt(i), FNV_PRIME) >>> 0;
  return Math.imul(next ^ 0xff, FNV_PRIME) >>> 0;
}

/** Digest of the dataset's analysis view, including row state and schema. */
export function peakDataFingerprint(ds: Dataset): string {
  const data = analysisData(ds) ?? ds.data;
  const view = new DataView(new ArrayBuffer(8));
  let hash = FNV_OFFSET_BASIS;
  for (const value of data.time) hash = fnvFloat(hash, view, value);
  for (const row of data.values) for (const value of row) hash = fnvFloat(hash, view, value);
  for (const value of data.labels) hash = fnvText(hash, value);
  for (const value of data.units) hash = fnvText(hash, value);
  return `2:${data.time.length}:${data.values.length}:${data.values[0]?.length ?? 0}:${ds.data.time.length}:${hash}`;
}

export function peakTableMatchesData(table: PeakTable, ds: Dataset): boolean {
  const fingerprint = table.provenance.fingerprint;
  return fingerprint === null || fingerprint === peakDataFingerprint(ds);
}
