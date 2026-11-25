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
import * as GLYPHS from "../../lib/glyphs";

/**
 * Node kind -> its type mark. INJECTIVE: no two kinds share a glyph.
 *
 * | kind               | glyph | code point | silhouette                        |
 * |--------------------|-------|------------|-----------------------------------|
 * | folder             | ▰     | U+25B0     | solid slanted bar — the only solid slab and the only slanted form; a folder tab. Adopted from TilePreview, which already drew folders this way. |
 * | workbook           | ⊟     | U+229F     | a squared minus: a bound book of sheets. Moved off ▤ (UX-G2) — ▤ is the TitleBar Library toggle. |
 * | worksheet          | ≡     | U+2261     | free-standing rules, no box: the rows of one sheet. The lightest mark in the set, deliberately — a worksheet is by far the most numerous row in an imported Origin project. |
 * | analysis-result    | ⌬     | U+232C     | a linked analysis record: distinct from its worksheet output. |
 * | origin-figure      | ⌁     | U+2301     | a zigzag trace: a plotted graph recovered from Origin. Unchanged. |
 * | origin-group       | ⊘     | U+2298     | a circled slash: the derived group of Origin graph entries with no bound source, or (variant `link-tables`) of Origin link-table books. |
 * | editable-figure    | ◇     | U+25C7     | outline diamond: a live figure document you can still edit. Unchanged. |
 * | publication-figure | ◆     | U+25C6     | solid diamond: the same family, set for publication. Replaces the old ◉/❄ pair, which swapped the TYPE mark to say "frozen" and so left a frozen publication figure with no type mark at all — frozen-ness is now its own ❄ status mark beside the name. |
 * | page               | ▢     | U+25A2     | a rounded empty square (▭ is the Rectangle shape tool): the blank canvas a figure page lays panels onto. |
 * | report             | ¶     | U+00B6     | a pilcrow: prose bound to a worksheet. |
 */
export const LIBRARY_NODE_GLYPH: Record<LibraryNodeKind, string> = {
  folder: GLYPHS.nodeFolder,
  workbook: GLYPHS.nodeWorkbook,
  worksheet: GLYPHS.nodeWorksheet,
  "analysis-result": GLYPHS.nodeAnalysisResult,
  "origin-figure": GLYPHS.nodeOriginFigure,
  "origin-group": GLYPHS.nodeOriginGroup,
  "editable-figure": GLYPHS.nodeEditableFigure,
  "publication-figure": GLYPHS.nodePublicationFigure,
  page: GLYPHS.nodePage,
  report: GLYPHS.nodeReport,
};

// The kind list, the type labels and the frozen mark live in ./nodeIconLabels.ts: only lazy rows read them.
export * from "./nodeIconLabels";
