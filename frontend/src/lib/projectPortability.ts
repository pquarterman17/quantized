// P1.7 box 1: the three project-portability modes a Quantized project can
// declare. This is a thin, stable-name TRANSCRIPTION of the written contract
// in plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md's P1.7 section — read that section
// for the full rationale; this module exists so code that needs to NAME a
// mode (today: none does, at runtime — see below) has one place to import
// the type from rather than inventing a string union at the call site.
//
// Only "embedded" is real today, and it isn't even a stored field — it's
// the ONLY behavior the app has ever had (L0.32: every import embeds a full
// snapshot in the .dwk). This module does not add a per-project mode
// TOGGLE; it names the mode space so `store/relink.ts` (the box-3 relink
// core this slice ships) and a future save-time mode switch share the exact
// same three names, instead of the switch inventing its own vocabulary
// later and leaving relink's docs/tests to describe a mode by prose alone.

/** - `"embedded"` — today's ONLY implemented mode, and the de-facto default
 *    (L0.32): the `.dwk` carries a full `DataStruct` snapshot for every
 *    dataset. Opening a project never requires its sources to be reachable;
 *    a source that later goes missing/offline/changes is entirely a
 *    Relink/Reimport concern (this slice, `store/relink.ts`), never an
 *    open-time failure. Every dataset's `source` field (path + provenance)
 *    still rides along, exactly as `Dataset.source`'s own doc describes —
 *    "linked metadata already rides along" is true of embedded mode too,
 *    it just isn't the ONLY thing saved.
 *
 *  - `"linked"` — the `.dwk` would store ONLY the source reference +
 *    provenance, no embedded snapshot; opening would RE-READ every source,
 *    so the project is only as portable as its sources are reachable from
 *    wherever it's opened (mirrors OriginPro's linked-workbook mode). NOT
 *    IMPLEMENTED this slice: no writer strips data at save time and no
 *    reader rehydrates it at open time yet. Deferred because it needs its
 *    own save-time UI decision (per-project? per-dataset?) and an open-time
 *    "resolve every source before the project is usable" flow that's a
 *    materially different shape from anything box 3 (relink) needed to
 *    build. Named home: a future P1.7 follow-up slice.
 *
 *  - `"portable"` — "embedded", PLUS the raw source files themselves get
 *    copied into a project-adjacent bundle at save time ("Pack Project"),
 *    so the project opens with zero dependency on the machine it was
 *    authored on (no network drive, no original folder layout). NOT
 *    IMPLEMENTED this slice — explicitly booked, per the audit plan's own
 *    "book the full portable-bundle packer to PR N territory if it doesn't
 *    fit" instruction. The relink machinery this slice ships
 *    (`lib/relink.ts`'s path matching, `store/relink.ts`'s dry-run +
 *    atomic commit) is exactly what a future packer would reuse to repoint
 *    every dataset's `source.path` at the bundle's own copies after
 *    unpacking — this slice is the packer's future dependency, not a
 *    parallel implementation of it. Named home: same P1.7 follow-up,
 *    tracked as "Pack Project" in the plan.
 */
export type ProjectPortabilityMode = "embedded" | "linked" | "portable";
