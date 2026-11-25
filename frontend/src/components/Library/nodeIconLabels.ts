// The lazy-only half of nodeIcons.ts (bundle diet, plans/BUNDLE_HEADROOM.md
// slice 34): the node kinds' plain-language names, the kind list the
// injectivity test walks, and the frozen-data mark. The eager Library tree
// needs only the glyph map; every reader of these is a lazy row, section or
// tile, so the code moved here verbatim and nodeIcons.ts re-exports it with
// `export *` - importers and tests are unchanged, and Rollup bundles this file
// with the lazy chunks that use it. architecture.test.ts ("re-exported lazy
// half") keeps eager modules off it.

import type { LibraryNode, LibraryNodeKind } from "../../lib/libraryHierarchy";
import { LINK_TABLES_GROUP_NAME } from "../../lib/libraryLinkTables";
import * as GLYPHS from "../../lib/glyphs";

/** Every Library node kind, in tree-hierarchy order. A literal list (rather
 *  than `Object.keys`) so the test can prove the map is complete AND that
 *  this list itself has not drifted from `LibraryNodeKind`. */
export const LIBRARY_NODE_KINDS = [
  "folder",
  "workbook",
  "worksheet",
  "analysis-result",
  "origin-figure",
  "origin-group",
  "editable-figure",
  "publication-figure",
  "page",
  "report",
] as const satisfies readonly LibraryNodeKind[];

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
  "analysis-result": "Analysis result",
  "origin-figure": "Origin figure",
  "origin-group": "Unresolved Origin figures",
  "editable-figure": "Editable figure",
  "publication-figure": "Publication figure",
  page: "Figure page",
  report: "Report",
};

/** The type label of one node: `LIBRARY_NODE_LABEL`, except that the
 *  `origin-group` holding Origin link-table books (variant `link-tables`) is
 *  not a group of figures. */
export function libraryNodeLabel(node: LibraryNode): string {
  return node.kind === "origin-group" && node.entity.variant === "link-tables"
    ? LINK_TABLES_GROUP_NAME
    : LIBRARY_NODE_LABEL[node.kind];
}

/** The mark a publication figure carries beside its type glyph when its data
 *  is frozen rather than re-read from the worksheet. A STATUS, not a type —
 *  which is the whole point: the old code swapped ◉ for ❄ and lost the type.
 *  Kept here so the injectivity test can see it. */
export const FROZEN_MARK = GLYPHS.frozen;

export const FROZEN_TITLE = "Frozen data — not re-read from the worksheet";
