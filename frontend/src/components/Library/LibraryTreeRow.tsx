import ArtifactRow from "./ArtifactRows";
import DatasetRow from "./DatasetRow";
import FigureRow from "./FigureRow";
import FolderRow from "./FolderRow";
import WorkbookRow from "./WorkbookRow";
import type { FlatLibraryNode, LibraryNode } from "../../lib/libraryHierarchy";

interface Props {
  row: FlatLibraryNode;
  activeId: string | null;
  selectedIds: ReadonlySet<string>;
  folderCounts: ReadonlyMap<string, number>;
  onFilterTag: (tag: string) => void;
  onFocusContainer?: (node: Extract<LibraryNode, { kind: "folder" | "workbook" }>) => void;
}

/** Kind dispatch kept out of LibraryTree's keyboard/virtualization controller. */
export default function LibraryTreeRow({ row, activeId, selectedIds, folderCounts, onFilterTag, onFocusContainer }: Props) {
  const { node, expanded, hasChildren } = row;
  switch (node.kind) {
    case "folder":
      return <FolderRow folder={node.entity} depth={node.depth} count={folderCounts.get(node.entityId) ?? 0} expanded={expanded} onFocus={onFocusContainer ? () => onFocusContainer(node) : undefined} />;
    case "workbook":
      return <WorkbookRow node={node} depth={node.depth} expanded={expanded} hasChildren={hasChildren} onFocus={onFocusContainer ? () => onFocusContainer(node) : undefined} />;
    case "worksheet":
      return <DatasetRow dataset={node.entity} active={node.entity.id === activeId} selected={selectedIds.has(node.entity.id)} showReorder={false} canMoveUp={false} canMoveDown={false} onFilterTag={onFilterTag} depth={node.depth} treeMode />;
    case "origin-figure":
      return <FigureRow entry={node.entity} depth={node.depth} treeMode />;
    default:
      return <ArtifactRow node={node} depth={node.depth} />;
  }
}
