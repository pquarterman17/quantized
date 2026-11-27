// Durable identity for positional fit subsets. Values cannot identify a row:
// repeated-X measurements are common, while Y must remain editable so a saved
// fit can legitimately recalculate. These private IDs instead follow worksheet
// row operations through lib/rowSidecars and round-trip in DataStruct.metadata.

import { FIT_ROW_IDENTITIES } from "./rowSidecars";
import type { Dataset, FitSpec } from "./types";

const ID = /^r1:[0-9a-z]{1,10}$/;

export function fitRowIdentities(metadata: Record<string, unknown>, rowCount: number): Map<number, string> | null {
  const raw = metadata[FIT_ROW_IDENTITIES];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = new Map<number, string>();
  const seen = new Set<string>();
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const row = Number(key);
    if (!Number.isInteger(row) || row < 0 || row >= rowCount || String(row) !== key ||
        typeof value !== "string" || !ID.test(value) || seen.has(value)) return null;
    out.set(row, value);
    seen.add(value);
  }
  return out;
}

/** A fresh opaque row identity, unused in `used`. RANDOM, never a counter: a counter restarts at 0 on a sheet
 *  whose identities were wiped (a re-import), so a link kept elsewhere (a subset's `__quantized_source_rows`)
 *  would then name a DIFFERENT row. Older files hold counter tokens (`r1:0`); they stay valid. */
export function mintRowId(used: ReadonlySet<string>): string {
  for (;;) {
    const token = Math.random().toString(36).slice(2, 10);
    const id = `r1:${token}`;
    if (token.length >= 6 && !used.has(id)) return id;
  }
}

/** Identities for `rows`, ADDED to the sheet's existing record: every other row keeps its token, so a fit's
 *  subset and every subset linked to this sheet survive each other. `null`: a row is out of range. */
export function installRowIdentities(
  metadata: Record<string, unknown>,
  rowCount: number,
  rows: readonly number[],
): { metadata: Record<string, unknown>; ids: Map<number, string> } | null {
  if (rows.some((row) => !Number.isInteger(row) || row < 0 || row >= rowCount)) return null;
  const current = fitRowIdentities(metadata, rowCount);
  const all = new Map(current ?? []);
  const used = new Set(all.values());
  const ids = new Map<number, string>();
  let changed = current === null && rows.length > 0;
  for (const row of rows) {
    let id = all.get(row);
    if (!id) {
      id = mintRowId(used);
      all.set(row, id);
      used.add(id);
      changed = true;
    }
    ids.set(row, id);
  }
  if (!changed) return { metadata, ids };
  const raw: Record<string, string> = {};
  for (const [row, id] of all) raw[String(row)] = id;
  return { metadata: { ...metadata, [FIT_ROW_IDENTITIES]: raw }, ids };
}

function mix(hash: number, value: number, prime: number): number {
  return Math.imul(hash ^ value, prime) >>> 0;
}

/** Ordered digest of opaque row IDs. The IDs themselves stay private metadata. */
export function fitRowIdentityFingerprint(ids: readonly string[]): string {
  let a = mix(0x811c9dc5, ids.length, 0x01000193);
  let b = mix(0x9747b28c, ids.length, 0x5bd1e995);
  for (const id of ids) {
    a = mix(a, id.length, 0x01000193);
    b = mix(b, id.length, 0x5bd1e995);
    for (let index = 0; index < id.length; index += 1) {
      a = mix(a, id.charCodeAt(index), 0x01000193);
      b = mix(b, id.charCodeAt(index), 0x5bd1e995);
    }
  }
  return `r1:${ids.length}:${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
}

/** Install/retain row identities and bind an explicit subset spec to them. */
export function bindFitRowIdentity(
  dataset: Dataset,
  spec: FitSpec,
): { metadata: Record<string, unknown>; spec: FitSpec; rowIdentities?: Record<string, string> } {
  if (spec.rowIds === undefined) return { metadata: dataset.data.metadata, spec };
  const bound = installRowIdentities(dataset.data.metadata, dataset.data.time.length, spec.rowIds);
  if (!bound) return { metadata: dataset.data.metadata, spec };
  const { metadata, ids } = bound;
  const selected = spec.rowIds.map((row) => ids.get(row)).filter((id): id is string => id !== undefined);
  if (selected.length !== spec.rowIds.length) return { metadata, spec };
  return {
    metadata,
    spec: { ...spec, rowIdentityFingerprint: fitRowIdentityFingerprint(selected) },
    rowIdentities: metadata[FIT_ROW_IDENTITIES] as Record<string, string>,
  };
}
