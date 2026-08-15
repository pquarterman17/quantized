// Light tree rows for the four artifact kinds that DON'T reuse an existing
// row component (LIBRARY_WORKBOOK_UX_PLAN PR C): editable figures,
// publication figures, pages, reports. Origin figures reuse FigureRow.tsx and
// worksheets reuse DatasetRow.tsx — both predate this hierarchy and carry
// their own established open/menu handlers (read per the plan's C brief); a
// generic name+glyph+meta row here would be strictly worse for them. These
// four kinds had no equivalent tree row at all before this PR — only a flat
// Library SECTION (EditableFiguresSection etc.) — so there's nothing
// established to preserve; a single click opens via the shared
// `openLibraryNode` dispatcher (the SAME action each section's own "open"
// button already calls), which also records L0.6's workbookLastChild.
//
// Deliberately no context menu yet: L0.39/L0.40 name new commands for these
// kinds, but only the WORKBOOK menu has a settled contract in this PR — see
// the plan's C scope note. Rename/duplicate/delete for these stay reachable
// through their existing flat-section buttons (search mode) until a later
// PR gives the tree row its own menu.

import type { LibraryNode } from "../../lib/libraryHierarchy";
import { useApp } from "../../store/useApp";
import { openLibraryNode } from "./libraryOpen";

type ArtifactNode = Extract<
  LibraryNode,
  { kind: "editable-figure" | "publication-figure" | "page" | "report" }
>;

interface Props {
  node: ArtifactNode;
  depth: number;
}

/** name -> Dataset, for the two kinds (editable figure, report) whose meta
 *  line names their bound worksheet. Publication figures and pages show
 *  self-contained meta (style / rows×cols) and don't need this lookup. */
function useDatasetName(datasetId: string | null | undefined): string {
  const datasets = useApp((s) => s.datasets);
  if (!datasetId) return "unbound";
  return datasets.find((d) => d.id === datasetId)?.name ?? "unbound";
}

function glyphAndMeta(node: ArtifactNode, datasetName: string): { glyph: string; meta: string } {
  switch (node.kind) {
    case "editable-figure":
      return { glyph: "◇", meta: datasetName };
    case "publication-figure":
      return { glyph: node.entity.live ? "◉" : "❄", meta: node.entity.config.style };
    case "page":
      return { glyph: "▦", meta: `${node.entity.rows}×${node.entity.cols}` };
    case "report":
      return { glyph: "▤", meta: datasetName };
  }
}

/** Hover title — kind-specific, wording IDENTICAL to each kind's flat
 *  section (EditableFiguresSection / SavedFiguresSection / PagesSection /
 *  ReportsSection), so the tree row and the search-mode section describe the
 *  same object the same way — and so the E2E journeys' title-based locators
 *  (figure-document-roundtrip et al.) address either rendering unchanged. A
 *  generic `open "name"` dropped the kind — worse hover text, and the reason
 *  four save/reopen journeys went red in tree mode. */
function openTitle(node: ArtifactNode): string {
  switch (node.kind) {
    case "editable-figure":
      return `open editable figure "${node.name}"`;
    case "publication-figure":
      return `open publication figure "${node.name}"${node.entity.live ? "" : " (frozen data)"} in Publication Preview`;
    case "page":
      return `open saved page "${node.name}"`;
    case "report":
      return `open report "${node.name}"`;
  }
}

export default function ArtifactRow({ node, depth }: Props) {
  const datasetId =
    node.kind === "editable-figure" ? node.entity.bindings.datasetId
      : node.kind === "report" ? node.entity.datasetId
      : null;
  const datasetName = useDatasetName(datasetId);
  const { glyph, meta } = glyphAndMeta(node, datasetName);

  return (
    <button
      className="qzk-fig-item"
      data-lib-row={node.key}
      style={depth ? { marginLeft: depth * 14 } : undefined}
      title={openTitle(node)}
      onClick={() => openLibraryNode(node)}
    >
      <span className="qzk-fig-name">{glyph} {node.name}</span>
      <span className="qzk-fig-meta">{meta}</span>
    </button>
  );
}
