// `Dataset.source`'s shape, split out of lib/types.ts (RSM_CUTS_PLAN #20's
// general .ts module-size ceiling — architecture.test.ts's pin left no room
// to grow that type inline for P1.7's provenance fields).
//
// Where this path/provenance came from and how it's used lives on the field
// itself in lib/types.ts (`Dataset.source`'s own doc comment — the "where a
// path is/isn't knowable" matrix); this file only owns the SHAPE.

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
 *  them. */
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
}
