// `runLazy`: the ONE sanctioned way to fire a click-/effect-deferred dynamic
// `import()` (P3.4, PRIMARY_SOFTWARE_AUDIT_PLAN). Moved here from
// commands/fileCommands.ts (which re-exports it) when the remaining bare
// `void import(...)` sites in components/ and App.tsx were routed through it:
// a failed lazy chunk load must show the standard error toast, never vanish
// as a silent no-op plus an unhandled-rejection console warning.
// architecture.test.ts ("no bare void import(") keeps new sites from
// reappearing. This module is statically reachable from the eager entry (via
// fileCommands.ts), so importing it from a lazy chunk adds no shared chunk.

import { withOp } from "../store/pendingOps";
import { toast } from "../store/toasts";

/** Wrap a dynamic `import()` in a pendingOp (F5, 2026-09-13 adversarial
 *  review of d6e67fb7's P3.4 export-cancel commit): every `void`-prefixed
 *  export command body in commands/fileCommands.ts was a bare `void import(...).then((m) =>
 *  m.runX(...))` with no `.catch` — a failed chunk load (offline right
 *  after a deploy, a stale cached HTML referencing a since-rotated hash) is
 *  a completely silent no-op PLUS an unhandled-rejection console warning,
 *  and for export-csv/export-hdf5 specifically a REGRESSION: before that
 *  file's bodies were moved behind a dynamic import, the export logic ran
 *  inline, so any failure was always caught by exportActive's own try/catch.
 *  The import step itself is new, and it sits OUTSIDE that try/catch.
 *
 *  This closes both gaps: `withOp` gives the click-to-chunk-loaded window
 *  (previously invisible) a busy indicator, and the `.catch` below toasts a
 *  load failure instead of leaving it unhandled. It wraps ONLY the import —
 *  by the time `load()` resolves, `endOp` has already fired (withOp's own
 *  `finally`), so the loaded module's own body (exportActive.ts's callers
 *  register their OWN pendingOp) never overlaps this one. Rethrows on
 *  failure so the caller's own `.then(...)` is skipped — the caller must
 *  still handle THAT rejection, with `.then(onRun, onLoadFailure)` (see
 *  `onLoadFailure` below and any call site); a success from the module's own
 *  body never reaches this catch, so it can't double-toast a failure
 *  exportActive already reported through its own status/toast. */
// 2026-09-14: shared by `commands/dataCommands.ts` (worksheet reshapes) and
// `commands/plotCommands.ts` (Page setup) for the identical reason; 2026-09-29
// by the Library, Stage, window-command and App.tsx startup loads as well,
// which is when it moved out of commands/fileCommands.ts to this neutral
// module (still eager through that module's re-export: no chunk boundary
// moves).
// N3 (2026-09-13 round-2 review): `label` is the pendingOps busy text
// ("Loading CSV export…"), already gerund-shaped — appending "failed to
// load" to it read as "Loading CSV export failed to load", doubling "load".
export function runLazy<M>(label: string, load: () => Promise<M>): Promise<M> {
  return withOp(label, load).catch((e: unknown) => {
    const what = label.replace(/^Loading\s+/, "").replace(/…$/, "");
    const msg = `Could not load the ${what}: ${e instanceof Error ? e.message : "error"}`;
    toast(msg, "danger");
    throw e;
  });
}

/** The ONLY rejection a chunk-deferred command body may swallow: the chunk
 *  load, which `runLazy` has already toasted.
 *
 *  Pass it as the SECOND argument of `.then(onRun, onLoadFailure)`, never as a
 *  trailing `.catch(() => {})`. A trailing `.catch` sits after `.then`, so it
 *  also swallows whatever the LOADED HANDLER throws — measured 2026-09-15 on
 *  the transpose seam: a handler that threw produced no toast, no status and
 *  no console error. With the two-argument form that throw reaches neither
 *  this function nor `runLazy`'s catch, and surfaces as an unhandled
 *  rejection — CONSOLE ONLY: `runAction` (`store/commands.ts`) never wraps
 *  these (each seam's `run` is `() => void runLazy(…)`, so `result` is not
 *  thenable) and `frontend/src` installs no `unhandledrejection` listener, so
 *  no toast, no status, no `pendingOps` entry. Scoped 2026-09-15 (review
 *  round 2, finding 4): that restores what 6 of the 7 seams did before
 *  lazification — the five exports and Page setup already rejected
 *  asynchronously — but the reshape seam (`dataCommands.ts`) threw
 *  SYNCHRONOUSLY out of `run()` as a loud React event-handler error, louder
 *  than this. Making it loud again is UX-003's call, not this helper's. */
export const onLoadFailure = (): void => {
  /* runLazy already toasted the load failure */
};
