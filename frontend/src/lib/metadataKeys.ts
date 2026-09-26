// Metadata → factors (PRIMARY_SOFTWARE_AUDIT_PLAN P2.5, "metadata cleanup /
// promotion to factors"): WHICH scalar metadata fields a selection of datasets
// carries, and where. Pure — no store, no React.
//
// A field lives either at the top level of `DataStruct.metadata` (`sample`,
// `temperature_setpoint`, a key an earlier cleanup unified) or ONE level into
// an instrument sidecar dict: Quantum Design's `INFO` lines land in
// `metadata.instrument` (`io/qd.py`), a text preamble's `key: value` lines in
// `metadata.header_fields` (`io/import_metadata.py`). A field is addressed by
// its PATH (`["sample"]`, `["instrument", "SAMPLE_MATERIAL"]`), never by a
// dotted string: an instrument key may itself contain a dot.
//
// Only SCALARS are offered (string, finite number, boolean). Collections —
// `comments`, `text_columns`, `label_rows`, a decoded Origin book inventory —
// are not one value per dataset, so they cannot become a per-dataset factor.

import { PREVIEW_SOURCE_ROWS } from "./rowSidecars";

export type MetaScalar = string | number | boolean;
export type MetaPath = string[];

/** Wiring, not instrument metadata (lib/metadata.ts hides the same keys from
 *  the Inspector card), plus this feature's own provenance log. */
const HIDDEN = new Set(["x_column_name", "x_column_unit", PREVIEW_SOURCE_ROWS, "metadata_cleanup"]);

export function isScalar(v: unknown): v is MetaScalar {
  return typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v));
}

const isDict = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Every scalar field of one metadata record, top level first. */
export function scalarFields(meta: Record<string, unknown> | undefined): [MetaPath, MetaScalar][] {
  const out: [MetaPath, MetaScalar][] = [];
  const nested: [MetaPath, MetaScalar][] = [];
  for (const [k, v] of Object.entries(meta ?? {})) {
    if (HIDDEN.has(k)) continue;
    if (isScalar(v)) out.push([[k], v]);
    else if (isDict(v)) {
      for (const [k2, v2] of Object.entries(v)) if (isScalar(v2)) nested.push([[k, k2], v2]);
    }
  }
  return [...out, ...nested];
}

/** The value at `path`, when it is a scalar; `undefined` otherwise. */
export function metaValue(meta: Record<string, unknown> | undefined, path: readonly string[]): MetaScalar | undefined {
  let v: unknown = meta;
  for (const k of path) {
    if (!isDict(v) || !Object.prototype.hasOwnProperty.call(v, k)) return undefined;
    v = v[k];
  }
  return isScalar(v) ? v : undefined;
}

/** A value that is really there: a blank string counts as missing, never as
 *  a level called "". */
export function isPresent(v: MetaScalar | undefined): v is MetaScalar {
  return v !== undefined && !(typeof v === "string" && v.trim() === "");
}

export const pathLabel = (path: readonly string[]): string => path.join(" › ");
/** A stable map/option key for a path. */
export const pathId = (path: readonly string[]): string => JSON.stringify(path);

export function pathFromId(id: string): MetaPath | null {
  try {
    const p: unknown = JSON.parse(id);
    return Array.isArray(p) && p.length > 0 && p.every((s) => typeof s === "string") ? (p as string[]) : null;
  } catch {
    return null;
  }
}

interface WithMeta {
  id: string;
  data: { metadata: Record<string, unknown> };
}

export interface MetaKeyInfo {
  path: MetaPath;
  label: string;
  /** The datasets (ids, in selection order) that carry a value at this path. */
  ids: string[];
}

/** Every scalar field across `datasets`, with its per-dataset coverage — most
 *  widely carried first, then top-level before nested, then by label. */
export function keysAcross(datasets: readonly WithMeta[]): MetaKeyInfo[] {
  const byId = new Map<string, MetaKeyInfo>();
  for (const d of datasets) {
    for (const [path, v] of scalarFields(d.data.metadata)) {
      if (!isPresent(v)) continue;
      const id = pathId(path);
      const info = byId.get(id) ?? { path, label: pathLabel(path), ids: [] };
      if (!info.ids.includes(d.id)) info.ids.push(d.id);
      byId.set(id, info);
    }
  }
  return [...byId.values()].sort(
    (a, b) => b.ids.length - a.ids.length || a.path.length - b.path.length || a.label.localeCompare(b.label),
  );
}
