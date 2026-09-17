// The workspace's shared object-id sequence, lifted verbatim out of
// store/useApp.ts (audit P4.1 — "decompose high-risk frontend god-modules").
// It moved for one reason: a module-level `let` cannot be incremented across
// an ES-module boundary, so any slice extracted out of useApp.ts that MINTS an
// id would otherwise have to either import from useApp.ts (a runtime cycle) or
// start a second counter (which would change the id numbering). Homing the
// counter in a module that imports NOTHING lets every minting slice draw from
// the one sequence, exactly as they did when they all lived in useApp.ts.
// Same move, same reason as store/liveWindowDocument.ts.
//
// WHAT THIS MODULE OWNS: the `_idSeq` counter and every `<prefix>-<t36>-<n>`
// minter that draws from it. One counter per PROCESS (module state, not store
// state) — unchanged from useApp.ts, where it also lived at module level, so a
// second `useApp` store (nothing constructs one) would share it either way.
// Ids are therefore unique across the whole workspace regardless of prefix,
// which is what store/split.ts relies on when it mints several dataset ids and
// a folder id in one pass.
//
// WHAT IT DOES NOT OWN: window ids (store/windows.ts has its own sequence),
// editable-figure ids (store/figureLifecycle.ts's `nextFigureId`), workbook
// ids (store/workbookIds.ts) and trash-entry ids. Those were already separate
// sequences before this module existed; nothing was merged into it.
//
// WHAT IT MUST NOT IMPORT: anything. It is a leaf — no store module, no lib/
// helper, no type. That is the whole point: every importer can depend on it
// without creating a cycle. (architecture.test.ts's "store/ layering guard"
// separately forbids a components/ import here, but nothing enforces the
// stricter leaf property — it is a convention this header states, kept true by
// the file having no import statement at all.)

let _idSeq = 0;
// Exported for store/split.ts (nextWindowId/panels.ts precedent) — a split
// mints several dataset ids + one folder id from the SAME sequence used
// everywhere else, so they can never collide with an id minted here.
export const nextDatasetId = (): string => `ds-${Date.now().toString(36)}-${++_idSeq}`;
export const nextFolderId = (): string => `fld-${Date.now().toString(36)}-${++_idSeq}`;
export const nextReportId = (): string => `rep-${Date.now().toString(36)}-${++_idSeq}`;
/** The `figd-` mint that `duplicateFigureDoc` used to spell inline in
 *  useApp.ts. Named (not inlined into store/reportsFigureDocs.ts) only so the
 *  counter can stay in ONE module; the produced string is character-for-
 *  character the template it replaced. */
export const nextFigureDocId = (): string => `figd-${Date.now().toString(36)}-${++_idSeq}`;
/** Likewise for `addSmartFolder`, which stays in useApp.ts. */
export const nextSmartFolderId = (): string => `smf-${Date.now().toString(36)}-${++_idSeq}`;
