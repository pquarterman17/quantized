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
