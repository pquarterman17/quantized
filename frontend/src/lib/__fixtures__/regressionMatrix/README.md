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
  fixture AND equality with the golden here, and documents the four screen/
  export divergences the matrix found.

**Adding a fixture / regenerating:** see the headers of
`regressionMatrixFixtures.testkit.ts` ("HOW TO ADD A FIXTURE") and
`regressionMatrix.test.ts` ("REGENERATING THE GOLDENS"). Never refresh a golden
just because a test went red — read the diff first.
