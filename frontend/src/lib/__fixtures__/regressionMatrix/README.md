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
and exits non-zero if any golden is stale. Eight figure goldens plus
`page.json` — nine in all.

**Adding a fixture:** see `regressionMatrixFixtures.testkit.ts`'s
"HOW TO ADD A FIXTURE", then run the script above and commit the new
`<name>.json`.

Never refresh a golden just because a test went red — read the diff first.
