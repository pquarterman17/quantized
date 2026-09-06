// `Dataset.source`'s shape, split out of lib/types.ts (RSM_CUTS_PLAN #20's
// general .ts module-size ceiling — architecture.test.ts's pin left no room
// to grow that type inline for P1.7's provenance fields).
//
// Where this path/provenance came from and how it's used lives on the field
// itself in lib/types.ts (`Dataset.source`'s own doc comment — the "where a
// path is/isn't knowable" matrix); this file only owns the SHAPE.

import { resolveBundlePath } from "./bundlePath";

/** Where a dataset's data can be re-read from on demand: a real path the
 *  path-based `/api/parsers/import` route already validated (MAIN_PLAN #10).
 *  See `Dataset.source`'s doc in lib/types.ts for the full picture.
 *
 *  P1.7 provenance (L0.32: "record source path, import time, observed
 *  modification time, and a checksum where practical"): `checksum`/`mtime`/
 *  `size` are captured from the desktop bridge's `probe_source` at IMPORT
 *  time — desktop-only ("where practical"; a browser upload has no bridge
 *  to ask, so they stay absent, never guessed) — and again at RELINK time
 *  for whichever new path a relink actually commits (`store/relink.ts`).
 *  Never silently rewritten otherwise: a reload/save round-trip through
 *  `.dwk` leaves them exactly as recorded, and `store/relink.ts`'s dry-run
 *  preview reads them read-only to decide a changed/unchanged/unknown
 *  verdict (`lib/relink.sourceChangeVerdict`) before any commit touches
 *  them.
 *
 *  P1.7 PR 3 (Pack Project, frontend half): `kind` stays `"path"` in memory
 *  even for a dataset loaded from a PACKED project — every downstream
 *  consumer (reimport, relink, pathState) keeps reading a real, absolute
 *  `path` exactly as before. What changes is provenance only: a source
 *  RESOLVED from a bundle-relative manifest entry (`lib/bundlePath.ts`)
 *  additionally carries `bundlePath` (the bundle-relative path it was
 *  resolved FROM) and, optionally, `packedFrom` (the absolute path the
 *  packer copied from — display-only provenance, never resolved back to a
 *  filesystem path). `lib/workspaceSerialize.ts`'s `serializeWorkspace` is
 *  what turns `bundlePath` back into an on-disk `kind: "bundle"` entry when
 *  it can prove the project is still saved next to its own bundle. */
export interface DatasetSource {
  kind: "path";
  path: string;
  /** `"sha256:<hex>"`, from `desktopBridge.probeSource`. Absent when no
   *  bridge was available to compute one, or the path wasn't yet
   *  read-consented at import time (desktop_bridge.py's P1.7 consent
   *  ruling) — an absent checksum is a genuine "not practical to compute
   *  here", never a zero/empty placeholder. */
  checksum?: string;
  /** Observed mtime (epoch seconds) at the moment `checksum`/`size` were
   *  captured. */
  mtime?: number;
  /** Observed size in bytes at the same moment. */
  size?: number;
  /** The bundle-relative path (e.g. "sources/run1.csv") this source was
   *  resolved FROM, present only when this dataset was loaded from a
   *  packed project (`parseDatasetSource` with a `projectDir` and a
   *  `kind: "bundle"` manifest entry). Never written directly by a caller
   *  — `serializeWorkspace` reads it back to decide whether the on-disk
   *  entry can round-trip as `kind: "bundle"` again (see its own doc). */
  bundlePath?: string;
  /** Provenance only: the absolute path the packer copied this source
   *  FROM, on whatever machine did the packing. Display-only — never
   *  resolved against the current filesystem (that machine may not even
   *  be this one) — carried through save/reopen for either `kind` so a
   *  packed project's "Show original location" affordance survives a
   *  round trip. */
  packedFrom?: string;
}

/** Validate a persisted `Dataset.source` (MAIN_PLAN #10) for
 *  `lib/workspace.ts`'s `parseWorkspace` — a stale/hand-edited value
 *  degrades to "no source" (the dataset falls back to "Re-import from
 *  file…") rather than throwing. Lives here, not inline in workspace.ts,
 *  for that module's own line-ceiling ratchet (architecture.test.ts) —
 *  cohesive with the type it validates either way.
 *
 *  P1.7 P1-B (adversarial review fix): this used to reconstruct a bare
 *  `{kind,path}` in workspace.ts, silently DROPPING checksum/mtime/size —
 *  which meant box 5's "changed source" protection degraded to "unknown"
 *  for every dataset the moment a project was reopened. Each field is
 *  independently validated and omitted (never defaulted) when malformed.
 *
 *  P1.7 PR 3: also accepts a persisted `kind: "bundle"` entry — but ONLY
 *  when `projectDir` is given (the caller knows where the `.dwk` itself
 *  lives — see lib/workspace.ts's `parseWorkspace` doc for who has one and
 *  who doesn't) AND the entry's `path` passes `isBundleRelativePath`.
 *  Either gap degrades exactly like any other malformed source — `null`,
 *  never a guess — which is the documented fallback: the dataset keeps its
 *  embedded data snapshot and offers "Re-import from file…". A conforming
 *  bundle entry resolves to an ordinary `kind: "path"` result carrying the
 *  resolved absolute path plus `bundlePath` (so `serializeWorkspace` can
 *  round-trip it back to `kind: "bundle"` later) and `packedFrom` when
 *  present. */
export function parseDatasetSource(v: unknown, projectDir?: string): DatasetSource | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const packedFrom = typeof o.packedFrom === "string" && o.packedFrom ? o.packedFrom : undefined;
  if (o.kind === "bundle") {
    if (projectDir === undefined || typeof o.path !== "string") return null;
    const resolved = resolveBundlePath(projectDir, o.path);
    if (resolved === null) return null;
    const source: DatasetSource = { kind: "path", path: resolved, bundlePath: o.path };
    if (typeof o.checksum === "string" && o.checksum) source.checksum = o.checksum;
    if (typeof o.mtime === "number" && Number.isFinite(o.mtime)) source.mtime = o.mtime;
    if (typeof o.size === "number" && Number.isFinite(o.size)) source.size = o.size;
    if (packedFrom) source.packedFrom = packedFrom;
    return source;
  }
  if (o.kind !== "path" || typeof o.path !== "string" || !o.path) return null;
  const source: DatasetSource = { kind: "path", path: o.path };
  if (typeof o.checksum === "string" && o.checksum) source.checksum = o.checksum;
  if (typeof o.mtime === "number" && Number.isFinite(o.mtime)) source.mtime = o.mtime;
  if (typeof o.size === "number" && Number.isFinite(o.size)) source.size = o.size;
  if (packedFrom) source.packedFrom = packedFrom;
  return source;
}
