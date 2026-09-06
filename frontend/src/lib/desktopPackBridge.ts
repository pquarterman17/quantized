// "Pack Project" wire calls (P1.7 PR 4) — the frontend half of
// quantized/desktop_bridge_pack.py's `DesktopPackBridge` mixin. Same rules
// as every other file in this family (desktopBridge.ts's own module doc):
// `null` = no usable bridge (degrade, never guess), a well-formed `{ok:
// false, error}` = a real, named refusal the caller should SAY, never
// silently swallow or treat as "no bridge". Re-exported from
// desktopBridge.ts (the desktopRelinkBridge.ts precedent) so importers of
// "lib/desktopBridge" see this surface too without a second import.
//
// Types below mirror `tests/fixtures/portable/manifest_v1.json` field for
// field — this is the wire shape `quantized.portable.manifest
// .build_dry_run_manifest` produces, byte-compared forever on the backend
// side; keep the two in lock-step on any manifest schema change.

import { api } from "./desktopBridge";

// -- the dry-run manifest (P1.7 PR 1) --------------------------------------

/** A source's `size`/`mtime`/`checksum` at some prior recording — the shape
 *  every dataset that shares a source records slightly differently, see
 *  `PortableSharedByEntry`. */
export interface PortableRecordedProvenance {
  checksum: string | null;
  mtime: number | null;
  size: number | null;
}

/** One dataset that shares this row's source (`shared: true` rows carry
 *  more than one). `verdict` is this dataset's OWN recorded provenance
 *  compared against the row's fresh probe — see `manifest.py`'s
 *  `_verdict` for the exact checksum-first, size/mtime-fallback rule. */
export interface PortableSharedByEntry {
  dataset_id: string;
  name: string;
  recorded: PortableRecordedProvenance;
  verdict: "unchanged" | "changed" | "unknown";
}

/** A source's reachability at manifest-build time — mirrors
 *  `desktop_source_probe.probe_source_path`'s own state set, plus the two
 *  manifest-only states (`invalid`: an unreadable/malformed original path
 *  shape; `not_consented`: skipped before ever being probed at all). */
export type PortableSourceStatus =
  | "ok"
  | "missing"
  | "offline"
  | "invalid"
  | "permission_denied"
  | "not_consented";

/** One row of `manifest.sources` — one UNIQUE original path (by
 *  `path_key`), regardless of how many datasets reference it. */
export interface PortableSourceRow {
  source_id: string;
  original_path: string;
  original_path_variants: string[];
  bundle_path: string;
  status: PortableSourceStatus;
  size: number | null;
  mtime: number | null;
  checksum: string | null;
  shared: boolean;
  shared_by: PortableSharedByEntry[];
  changed: boolean;
  unverified: boolean;
  packable: boolean;
  blockers: string[];
  warnings: string[];
  collision_group: number | null;
  renamed_from: string | null;
  /** Present only once a source has actually been staged (PR 2/3) — a
   *  dry-run preview's rows never carry this field at all. */
  packed?: { checksum: string; bytes: number } | null;
}

/** One row of `manifest.datasets` — one entry PER DATASET (unlike
 *  `sources`, which dedupes by original path). A dataset with no usable
 *  source at all carries `note` and a `null` `source_id`; every other
 *  dataset carries a `source_id` naming its `PortableSourceRow` and no
 *  `note`. */
export interface PortableDatasetEntry {
  dataset_id: string;
  name: string;
  source_id: string | null;
  note?: "embedded_only" | "unsupported_source_kind" | "malformed_source";
}

export interface PortableManifestWarning {
  code: string;
  source_id: string;
  message: string;
}

export interface PortableManifestSummary {
  datasets: number;
  sources: number;
  packable: number;
  blocked: number;
  shared: number;
  total_bytes: number;
  warnings: number;
  /** Present only on a FINALIZED (`dry_run: false`) manifest. */
  packed?: number;
}

export interface PortableManifest {
  format: string;
  manifest_version: number;
  dry_run: boolean;
  project: {
    name: string;
    project_file: string;
    workspace_format: string | null;
    workspace_version: number | null;
    renamed_from: string | null;
  };
  layout: { manifest_file: string; sources_dir: string };
  sources: PortableSourceRow[];
  datasets: PortableDatasetEntry[];
  warnings: PortableManifestWarning[];
  summary: PortableManifestSummary;
  /** Present only on a FINALIZED (`dry_run: false`) manifest. */
  packed_at?: string;
}

// -- pack_preview -----------------------------------------------------------

export interface PackPreviewOk {
  ok: true;
  token: string;
  manifest: PortableManifest;
  destination: { bundle_dir: string; exists: boolean };
  warnings: PortableManifestWarning[];
  blockers: PortableSourceRow[];
}

export interface PackError {
  ok: false;
  error: { code: string; message?: string };
}

export type PackPreviewResult = PackPreviewOk | PackError;

// -- pack_status --------------------------------------------------------

export type PackStage = "copying" | "verifying" | "publishing" | null;

export interface PackProgress {
  current_file: string | null;
  completed_files: number;
  total_files: number;
  bytes_copied: number;
  bytes_total: number;
  stage: PackStage;
}

export interface PackStatusError {
  code: string;
  message: string;
  originals_modified: false;
  note: string;
  source_id?: string;
  bundle_path?: string;
}

export type PackPhase = "idle" | "packing" | "cancelling" | "completed" | "cancelled" | "failed";

export interface PackStatus {
  phase: PackPhase;
  progress: PackProgress;
  warnings: PortableManifestWarning[];
  errors: PackStatusError[];
  result: { bundle_dir: string } | null;
  cleanup_ok: boolean | null;
  originals_modified: false;
}

// -- wire calls ---------------------------------------------------------

/** Same shape/pattern as `pickRelinkDirectory` (desktopRelinkBridge.ts):
 *  `null` = no usable bridge (fall back to typing a path, which never gets
 *  a grant — a "Pack Project" panel with no bridge has nothing to offer at
 *  all); a real return mints a WRITE-DIRECTORY grant on the backend for
 *  the chosen folder — the bundle is created INSIDE it. */
export async function pickPackDestination(directory?: string): Promise<string | null> {
  const bridge = api();
  if (!bridge?.pick_pack_destination) return null;
  try {
    const out = (await bridge.pick_pack_destination(directory ?? "")) as { path?: unknown };
    return typeof out.path === "string" ? out.path : null;
  } catch {
    return null;
  }
}

/** Dry-run plan for packing `content` as `<projectName>.dwk` into a fresh
 *  bundle directory inside `destinationParent` (which must already carry a
 *  write-directory grant from `pickPackDestination`). `null` = no usable
 *  bridge; a `PackError` names why the backend refused (never a path). */
export async function packPreview(
  content: string,
  projectName: string,
  destinationParent: string,
): Promise<PackPreviewResult | null> {
  const bridge = api();
  if (!bridge?.pack_preview) return null;
  try {
    const out = await bridge.pack_preview(content, projectName, destinationParent);
    // A minimal shape check (the discriminant, not every nested manifest
    // field) — the bridge is an in-process trusted peer, not adversarial
    // network input, but a malformed/missing response must still degrade
    // to `null` rather than hand a caller a value that fails its own type.
    if (typeof out.ok !== "boolean") return null;
    return out as unknown as PackPreviewResult;
  } catch {
    return null;
  }
}

/** Start the actual copy/publish pipeline. `token` must be the EXACT token
 *  `packPreview` returned, and `content` must be byte-identical to what
 *  was previewed — any mismatch is `stale_preview`, never a silent re-plan
 *  against different data. `null` = no usable bridge. */
export async function packStart(token: string, content: string): Promise<{ ok: boolean; error?: { code: string; message?: string } } | null> {
  const bridge = api();
  if (!bridge?.pack_start) return null;
  try {
    return (await bridge.pack_start(token, content)) as { ok: boolean; error?: { code: string; message?: string } };
  } catch {
    return null;
  }
}

/** Poll the current job's status. `null` = no usable bridge — the caller's
 *  polling loop should stop and report failure, never spin forever on a
 *  bridge that was never there. */
export async function packStatus(): Promise<PackStatus | null> {
  const bridge = api();
  if (!bridge?.pack_status) return null;
  try {
    const out = await bridge.pack_status();
    if (typeof out.phase !== "string") return null; // same minimal-shape rule as `packPreview`
    return out as unknown as PackStatus;
  } catch {
    return null;
  }
}

/** Idempotent. `null` = no usable bridge. */
export async function packCancel(): Promise<{ ok: boolean; phase: PackPhase } | null> {
  const bridge = api();
  if (!bridge?.pack_cancel) return null;
  try {
    return (await bridge.pack_cancel()) as { ok: boolean; phase: PackPhase };
  } catch {
    return null;
  }
}

/** Clears a terminal job record so a retry can start. Rejected (`ok:
 *  false`) while an operation is actually running. `null` = no usable
 *  bridge. */
export async function packReset(): Promise<{ ok: boolean; error?: { code: string } } | null> {
  const bridge = api();
  if (!bridge?.pack_reset) return null;
  try {
    return (await bridge.pack_reset()) as { ok: boolean; error?: { code: string } };
  } catch {
    return null;
  }
}
