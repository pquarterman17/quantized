# Frozen FigureDocument v1 fixture (PRIMARY_SOFTWARE_AUDIT_PLAN — migration fixtures)

`v1.json` is a hand-built but schema-exact `FigureDocumentV1` document,
reconstructed from the shape `createFigureDocument` produced at commit
`09830d05` ("feat: define canonical figure document") — the last commit
before F2.1a ("feat: preserve publication state in figure documents",
`049ad67f`) bumped `FIGURE_DOCUMENT_VERSION` to 2 and added the optional
`publication` field. A genuine v1 document never had that field at all
(not even `undefined`), which is exactly what this fixture omits.

Never hand-edit this file to "fix" a failing test — a failure against it is
a migration-compatibility question for a human, the same discipline as
`__fixtures__/workspace/README.md` and the root `CLAUDE.md`'s golden-parity
notes. See `figureDocumentMigration.test.ts` for the load-path assertions.

`v2-overlays.json` (gap audit 5, lane C) is a schema-exact v2 document with
the optional `overlays` section: a fit with a two-edge band and peak markers,
row-aligned to the 3-row loop `figureDocumentMigration.test.ts` defines. Its
`rows` value is `lib/dataFingerprint.ts`'s hash of that loop; a hash change
would orphan every saved fit, so the test fails rather than the fixture being
regenerated.
