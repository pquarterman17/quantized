// The lazy-only half of toasts.ts (bundle diet, plans/BUNDLE_HEADROOM.md slice 34):
// the migration-warning toast. Only lazy modules call it.
// The code moved here verbatim and toasts.ts re-exports it with `export *` -
// importers and tests are unchanged, and Rollup bundles this file with the
// lazy chunks that use it. architecture.test.ts ("re-exported lazy half")
// keeps eager modules off it.

import { TOAST_ACTION_TTL, toast } from "./toasts";

/** BUG-010: fire ONE toast summarizing `warnings` (a load/merge path's
 *  `migrationWarnings` — a skipped/degraded field from an older or
 *  unsupported saved document) — the first warning's text plus a "(+N more)"
 *  count, never one toast per warning. No-op when empty, so every load/merge
 *  call site can call this unconditionally. Lives here (not a separate lib
 *  module) because every call site already imports `toast` from this exact
 *  module — one shared helper with no new module edge to pay for. See
 *  BUGS_AND_ISSUES.md's BUG-010 entry for why `useApp.ts`'s own
 *  `migrationNotice` status-line fold (File ▸ Open only) isn't enough.
 *
 *  Review round (BUG-010 fix review): on two call sites (`applyRecoveryChoice
 *  .ts`'s `applyRecoverAutosave`, `useWorkspaceAutosave.ts`'s silent restore)
 *  a later `setStatus` deliberately overwrites `loadWorkspace`'s own
 *  migration-notice status-line fold, so this toast is the ONLY surface
 *  "part of your saved document was dropped" gets there — worth more than a
 *  glance-length confirmation. `ToastKind` has no dedicated "warning" value
 *  (`"info" | "ok" | "danger"`, above), so this keeps `"info"` — the SAME
 *  kind `useWorkspaceAutosave.ts`'s "Recovered … check your latest edits"
 *  toast already uses for an analogous "something was silently changed, go
 *  look" notice, rather than reaching for `"danger"` (reserved for an
 *  operation that failed outright; a migration warning is a successful load
 *  that dropped one degraded piece, not a failure) — and upgrades the
 *  lifetime from the default `TOAST_TTL` to `TOAST_ACTION_TTL` (6 s instead
 *  of 1.9 s) so it has a real chance of being read before it self-dismisses,
 *  even though it carries no action button of its own. */
export function notifyMigrationWarnings(warnings: readonly string[]): void {
  if (!warnings.length) return;
  toast(warnings[0] + (warnings.length > 1 ? ` (+${warnings.length - 1} more)` : ""), "info", { ttlMs: TOAST_ACTION_TTL });
}
