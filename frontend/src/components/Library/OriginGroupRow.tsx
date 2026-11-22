// (Also the "Origin link tables" row, `variant: "link-tables"`: it holds
// link-table BOOKS, not figure entries; same disclosure, different children.)
// The virtual "Unresolved Origin figures (N)" row in the Library tree: one
// collapsed disclosure per imported project that gathers the graph entries
// that bound no source (lib/libraryHierarchy.ts `origin-group`; derived, never
// stored). It is a DISCLOSURE header, not a selectable item: the entries
// inside stay ordinary FigureRows (selectable, Recover…, Open), so selection,
// Delete and import targeting never see the group.
//
// Mouse: a click anywhere on the row (caret included) toggles it. Keyboard:
// LibraryTree already routes Enter / ← / → / Space for every treeitem; this
// row supplies the toggle through `openLibraryNode` (Enter) and the
// `toggleExpand` hook there (←/→), and Space below.

import { plural } from "../../lib/plural";
import type { LibraryNode } from "../../lib/libraryHierarchy";
import { spaceActivates, type TreeItemProps } from "../../lib/libraryTreeNav";
import { useLibraryStore } from "../../store/hooks/useLibraryStore";
import { LINK_TABLES_NOTE } from "../../lib/libraryLinkTables";
import { LIBRARY_NODE_GLYPH, libraryNodeLabel } from "./nodeIcons";

interface Props {
  node: Extract<LibraryNode, { kind: "origin-group" }>;
  depth: number;
  expanded: boolean;
  /** Set inside LibraryTree: treeitem semantics + the roving tab stop (U5). */
  treeItem?: TreeItemProps;
}

export default function OriginGroupRow({ node, depth, expanded, treeItem }: Props) {
  const toggle = useLibraryStore((s) => s.toggleOriginGroupExpanded);
  const { id, stem, count, variant } = node.entity;
  const linkTables = variant === "link-tables";
  const what = linkTables
    ? `${count} Origin link table${plural(count)}: ${LINK_TABLES_NOTE}`
    : `${count} graph window${plural(count)} from ${stem} with no matching imported book`;
  return (
    <div
      className="qzk-folder-head qzk-origin-group-row"
      style={{ paddingLeft: 6 + depth * 14 }}
      data-lib-row={node.key}
      tabIndex={0}
      {...treeItem}
      aria-label={`${node.name}: ${what}; ${expanded ? "expanded" : "collapsed"}`}
      title={linkTables
        ? `${what}. These books hold links into Origin fit reports; every book is kept.`
        : `${what}. Expand to inspect each one; Recover… on a row chooses its source.`}
      onClick={() => toggle(id)}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => spaceActivates(e, () => toggle(id))}
    >
      {/* Invisible stand-ins for a workbook row's drag grip and "⋯" button (a
       *  group has neither), so the caret and glyph line up with the sibling
       *  book rows' instead of sitting a column to their left. */}
      <span className="qzk-drag-handle" aria-hidden="true" style={{ visibility: "hidden" }}>⠿</span>
      <span className="qzk-menu-btn" aria-hidden="true" style={{ visibility: "hidden" }}>⋯</span>
      <span className="qzk-group-caret" aria-hidden="true">{expanded ? "▾" : "▸"}</span>
      <span className="qzk-workbook-icon" aria-hidden="true" title={libraryNodeLabel(node)}>
        {LIBRARY_NODE_GLYPH["origin-group"]}
      </span>
      <span className="qzk-group-name">{node.name}</span>
      {linkTables && <span className="qzk-group-note">{LINK_TABLES_NOTE}</span>}
      <span className="qzk-group-count" title={linkTables ? what : `${count} unresolved graph window${plural(count)}`}>{count}</span>
    </div>
  );
}
