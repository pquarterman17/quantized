# Frozen PeakRecipe v1 fixture (PRIMARY_SOFTWARE_AUDIT_PLAN — migration fixtures)

`v1.json` is a schema-exact pre-P2.4-slice-3 `StoredPeakRecipe`: no `fit`
section at all (that section, and `PEAK_RECIPE_VERSION` bumping to 2, is
the mixed-shape model-fit addition — `upgradePeakRecipe` migrates a v1
record to v2 by attaching `DEFAULT_FIT` verbatim, "lossless, so no
warning" per `lib/peakwizard.ts`'s own version notes). This is what
`localStorage["qz.peakRecipes"]` held before that slice landed.

Never hand-edit this file. See `peakRecipesMigration.test.ts` for the
load-path assertions.
