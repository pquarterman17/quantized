# Frozen PageDocument v1 fixture (PRIMARY_SOFTWARE_AUDIT_PLAN — migration fixtures)

`v1.json` is a hand-built but schema-exact pre-F3.5 `PageDocument`: no
`layout` field (that block — gap/link/align/resize-mode — is the v1->v2
render-semantics bump per `lib/pageDocument.ts`'s own version-notes
comment) and no `createdAt`/`modifiedAt` (F3.3's own comment notes no
writer had ever produced a page document before that field existed, so a
genuine v1 fixture correctly omits it too — `sanitizePageDocument`
defaults both to the epoch).

Never hand-edit this file — see `__fixtures__/workspace/README.md` for the
discipline. See `pageDocumentMigration.test.ts` for the load-path
assertions.
