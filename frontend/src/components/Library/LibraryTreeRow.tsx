import ArtifactRow from "./ArtifactRows";
import DatasetRow from "./DatasetRow";
import FigureRow from "./FigureRow";
import FolderRow from "./FolderRow";
import OriginGroupRow from "./OriginGroupRow";
import WorkbookRow from "./WorkbookRow";
import type { FlatLibraryNode, LibraryNode } from "../../lib/libraryHierarchy";
import type { TreeItemProps } from "../../lib/libraryTreeNav";

interface Props {
  row: FlatLibraryNode;
  /** WAI-ARIA treeitem attributes for the row's anchor (LibraryTree, U5). */
  treeItem: TreeItemProps;
  /** The row's own highlight (isRowSelected): for a collapsed single-sheet
   *  workbook row it also reads the WORKBOOK selection. */
  selected: boolean;
  activeId: string | null;
  folderCounts: ReadonlyMap<string, number>;
  onFilterTag: (tag: string) => void;
  onFocusContainer?: (node: Extract<LibraryNode, { kind: "folder" | "workbook" }>) => void;
}

/** Kind dispatch kept out of LibraryTree's keyboard/virtualization controller. */
export default function LibraryTreeRow({ row, treeItem, selected, activeId, folderCounts, onFilterTag, onFocusContainer }: Props) {
  const { node, expanded, hasChildren } = row;
  switch (node.kind) {
    case "folder":
      return <FolderRow folder={node.entity} depth={node.depth} count={folderCounts.get(node.entityId) ?? 0} expanded={expanded} treeItem={treeItem} onFocus={onFocusContainer ? () => onFocusContainer(node) : undefined} />;
    case "workbook":
      return <WorkbookRow node={node} depth={node.depth} expanded={expanded} hasChildren={hasChildren} treeItem={treeItem} onFocus={onFocusContainer ? () => onFocusContainer(node) : undefined} />;
    case "worksheet":
      return <DatasetRow dataset={node.entity} active={node.entity.id === activeId} selected={selected} showReorder={false} canMoveUp={false} canMoveDown={false} onFilterTag={onFilterTag} depth={node.depth} treeMode treeItem={treeItem} workbook={row.workbook} onFocusWorkbook={onFocusContainer && row.workbook ? () => onFocusContainer(row.workbook!) : undefined} />;
    case "origin-group":
      return <OriginGroupRow node={node} depth={node.depth} expanded={expanded} treeItem={treeItem} />;
    case "origin-figure":
      return <FigureRow entry={node.entity} depth={node.depth} treeMode treeItem={treeItem} />;
    default:
      return <ArtifactRow node={node} depth={node.depth} treeItem={treeItem} />;
  }
}
