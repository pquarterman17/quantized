// THE single source of truth for Library node-type iconography.
//
// Why this file exists (owner report, 2026-09-19: "loading this origin
// project, it's pretty impossible to parse that many icons"): the node-type
// glyph was declared independently at eight sites in three mutually
// CONTRADICTING maps, and the marks collided. Measured before this module:
//
//   ▦ (U+25A6) meant Folder      (FolderRow, CollectionsSection, DetailsRow)
//              AND Figure page   (ArtifactRows, PagesSection)
//              AND Worksheet     (TilePreview)
//              AND "open the source workbook" (FigureRow's command button)
//              AND "New folder"  (Library.tsx's toolbar button)
//   ▤ (U+25A4) meant Workbook    (WorkbookRow, CollectionsSection, DetailsRow,
//                                 TilePreview)
//              AND Report        (ArtifactRows, ReportsSection)
//   ▥ (U+25A5) meant Worksheet   (DatasetRow)
//              AND Origin figure, Editable figure, Publication figure,
//                  Figure page AND Report, all five at once
//                                (CollectionsSection)
//   ▰ meant Folder and ▧ meant Figure page in TilePreview only, while
//   CollectionsSection and DetailsRow rendered a worksheet as a bare "·".
//
// So the same entity wore a different mark depending on which view drew it,
// and one mark meant up to five different entities in a single list. On top
// of that ▦/▤/▥ differ ONLY in hatch direction — at the 12px the tree renders
// them, in a project with hundreds of rows, they are one smudge.
//
// The vocabulary below therefore separates the eight kinds by SILHOUETTE, not
// by hatch: a solid slanted bar, a ruled box, free-standing rules, a zigzag
// trace, an outline diamond, a solid diamond, a wide empty rectangle and a
// pilcrow. No two share a shape family except the two figure-document kinds,
// which are deliberately one family (both are "a figure you composed") split
// by fill — a far coarser contrast than hatch direction, and the pair never
// denotes one entity twice.
//
// `plans/design/DESIGN_GUIDE.md` (the UI authority) specifies the MEDIUM —
// inline Unicode glyphs inheriting `currentColor` and the surrounding
// font-size, thin/geometric, never emoji, never an icon font or SVG sprite —
// and names a handful of TOOL glyphs (✥ pan, ⛶ box-zoom, ✛ cursor, ▾/▸
// chevrons, and ▤/▥ as PANEL TOGGLES). It does not specify a Library
// node-type vocabulary, so this file defines one in that idiom. Note the
// guide's own assignment of ▤/▥ to panel toggles: reusing them as node types
// was already double duty.
//
// Colour is deliberately NOT a channel here. Every glyph inherits
// `currentColor` from its row (`--text-dim` via `.qzk-ds-icon` et al.), so
// the vocabulary survives every theme, the density switch, greyscale and the
// print/export paths, and carries no information a colour-blind reader
// loses. FolderRow additionally tints its folder glyph with the folder's own
// user-chosen swatch — that tint is decoration on top of an already-distinct
// shape, never the thing that tells a folder from a workbook.
//
// `nodeIcons.test.ts` asserts this map is INJECTIVE over the complete kind
// set, and that none of its marks collides with the command/status glyphs a
// Library row also renders. That test is the reason the collisions above
// cannot come back.

import type { LibraryNodeKind } from "../../lib/libraryHierarchy";

/** Every Library node kind, in tree-hierarchy order. A literal list (rather
 *  than `Object.keys`) so the test can prove the map is complete AND that
 *  this list itself has not drifted from `LibraryNodeKind`. */
export const LIBRARY_NODE_KINDS = [
  "folder",
  "workbook",
  "worksheet",
  "origin-figure",
  "editable-figure",
  "publication-figure",
  "page",
  "report",
] as const satisfies readonly LibraryNodeKind[];

/**
 * Node kind -> its type mark. INJECTIVE: no two kinds share a glyph.
 *
 * | kind               | glyph | code point | silhouette                        |
 * |--------------------|-------|------------|-----------------------------------|
 * | folder             | ▰     | U+25B0     | solid slanted bar — the only solid slab and the only slanted form; a folder tab. Adopted from TilePreview, which already drew folders this way. |
 * | workbook           | ▤     | U+25A4     | the ONE box, ruled: a bound book of sheets. Unchanged — it was never ambiguous on its own, only against ▦/▥. |
 * | worksheet          | ≡     | U+2261     | free-standing rules, no box: the rows of one sheet. The lightest mark in the set, deliberately — a worksheet is by far the most numerous row in an imported Origin project. |
 * | origin-figure      | ⌁     | U+2301     | a zigzag trace: a plotted graph recovered from Origin. Unchanged. |
 * | editable-figure    | ◇     | U+25C7     | outline diamond: a live figure document you can still edit. Unchanged. |
 * | publication-figure | ◆     | U+25C6     | solid diamond: the same family, set for publication. Replaces the old ◉/❄ pair, which swapped the TYPE mark to say "frozen" and so left a frozen publication figure with no type mark at all — frozen-ness is now its own ❄ status mark beside the name. |
 * | page               | ▭     | U+25AD     | a wide empty rectangle: the blank canvas a figure page lays panels onto. |
 * | report             | ¶     | U+00B6     | a pilcrow: prose bound to a worksheet. |
 */
export const LIBRARY_NODE_GLYPH: Record<LibraryNodeKind, string> = {
  folder: "▰",
  workbook: "▤",
  worksheet: "≡",
  "origin-figure": "⌁",
  "editable-figure": "◇",
  "publication-figure": "◆",
  page: "▭",
  report: "¶",
};

/** Node kind -> its plain-language name, used as the type mark's `title`
 *  (a bare glyph reads as nothing to a screen reader or a new user) and as
 *  the Tiles card's accessible name. Wording is unchanged from
 *  `TilePreview`'s former local `KIND_LABEL`, which these strings replace —
 *  `FolderRow`/`WorkbookRow`/`DatasetRow` already titled their glyphs
 *  "Folder"/"Workbook"/"Worksheet" to match. */
export const LIBRARY_NODE_LABEL: Record<LibraryNodeKind, string> = {
  folder: "Folder",
  workbook: "Workbook",
  worksheet: "Worksheet",
  "origin-figure": "Origin figure",
  "editable-figure": "Editable figure",
  "publication-figure": "Publication figure",
  page: "Figure page",
  report: "Report",
};

/** The mark a publication figure carries beside its type glyph when its data
 *  is frozen rather than re-read from the worksheet. A STATUS, not a type —
 *  which is the whole point: the old code swapped ◉ for ❄ and lost the type.
 *  Kept here so the injectivity test can see it. */
export const FROZEN_MARK = "❄";
export const FROZEN_TITLE = "Frozen data — not re-read from the worksheet";
