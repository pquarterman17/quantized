// The lazy-only half of projectLockPaths.ts (bundle diet, plans/BUNDLE_HEADROOM.md slice 34):
// the read-only open message. Only the lazy open flow and project-follows-history print it.
// The code moved here verbatim and projectLockPaths.ts re-exports it with `export *`:
// importers and tests are unchanged, and Rollup bundles this file with the
// lazy chunks that use it. architecture.test.ts ("re-exported lazy half")
// keeps eager modules off it.

/** Why a project opened read-only, with the next step (shared by the open flow and project-follows-history). */
export function readOnlyOpenReason(status: string): string {
  return status === "held-by-other-stale"
    ? "another (unresponsive) instance has this project open — Take Over Editing is available"
    : "another instance has this project open for editing — opened read-only";
}
