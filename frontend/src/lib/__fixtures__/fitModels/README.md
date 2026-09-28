# Frozen CustomFitModel v1 fixture (PRIMARY_SOFTWARE_AUDIT_PLAN — migration fixtures)

`v1.json` is a schema-exact v1 record (no `description`, no `units` —
`CUSTOM_FIT_MODEL_VERSION` bumped to 2, audit P2.7 slice 3, only when a
saved model actually carries one of those; a v1 record has neither field
at all). This is what `localStorage["qz.customFitModels"]` held before
that slice landed.

Never hand-edit this file. See `fitModelsMigration.test.ts` for the
load-path assertions.
