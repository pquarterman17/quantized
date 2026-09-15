# P4.2 regression-matrix goldens

One frozen JSON file per canonical figure (plus `page.json`), holding the
**canonical structural projection** of that fixture as the SCREEN path renders
it — series order/binding/style, error spans, grouping/facet/y2/break/waterfall
settings, axis labels/limits/scales, and decorations.

* The fixtures themselves are TS builders
  (`../../regressionMatrixFixtures.testkit.ts`), not recorded input, so they are
  deterministic on every platform.
* The projection shape and the three per-path extractors live in
  `../../regressionMatrix.testkit.ts`, `../../regressionMatrixLegs.testkit.ts`
  and `../../regressionMatrixPage.testkit.ts`.
* `../../regressionMatrix.test.ts` asserts screen ≡ export ≡ reopen for each
  fixture AND equality with the golden here, and pins the five screen/export
  divergences the matrix found (BUG-012 … BUG-016).

**Regenerating:** `cd frontend && node scripts/freeze-regression-matrix.mjs`
rewrites every file here from the TS builders; `--check` diffs without writing
and exits non-zero, naming every stale file, if any golden disagrees with the
committed bytes. Eight figure goldens plus `page.json` — nine in all.

**Verifying `--check` is actually read-only (2026-09-15).** `--check` used to
silently REWRITE stale goldens and exit 0 always — the flag was read from
`process.argv` at module scope, but the projection runs inside a forked/
threaded vitest worker (the script re-enters through `startVitest`; see the
comment block at the top of the script) whose own `argv` never carries
`--check`, so the worker always took the write path. Fixed by threading
`--check` to the worker as an env var (`FREEZE_CHECK`) instead of relying on
`process.argv` there. `src/lib/freezeRegressionMatrixCheck.test.ts` is an
automated guard that spawns the real script against a throwaway directory,
hand-perturbs a golden, and asserts `--check` is read-only and fails
non-zero while write mode still regenerates byte-identically — run it with
`npx vitest run src/lib/freezeRegressionMatrixCheck.test.ts` (~15s). The same
thing can be checked by hand against the real goldens: perturb one number in
a committed `<name>.json`, run `--check` (non-zero exit, the file's name in
the output, the file left perturbed — `git status` shows it modified), then
run the plain (no-flag) form (exit 0, `git diff` empty again).

**Adding a fixture:** see `regressionMatrixFixtures.testkit.ts`'s
"HOW TO ADD A FIXTURE", then run the script above and commit the new
`<name>.json`.

Never refresh a golden just because a test went red — read the diff first.
