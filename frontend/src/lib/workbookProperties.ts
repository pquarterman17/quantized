// Read-only workbook inspector projection.  This deliberately starts with a
// canonical workbook LibraryNode, rather than re-grouping worksheets from
// Origin metadata: Tree, Details, Tiles, and this dialog must describe the
// same hierarchy.

import type { LibraryNode } from "./libraryHierarchy";
import type { FolderNode } from "./types";

export interface WorkbookProperties {
  name: string;
  location: string;
  source: string;
  sourcePath: string | null;
  originBook: string | null;
  availability: string;
  worksheetCount: number;
  artifactCount: number;
  tags: readonly string[];
  importedAt: string | null;
}

function folderLocation(folderId: string | undefined, folders: readonly FolderNode[]): string {
  if (!folderId) return "Project";
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const names: string[] = [];
  const seen = new Set<string>();
  let current = folderId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const folder = byId.get(current);
    if (!folder) break;
    names.unshift(folder.name);
    current = folder.parentId ?? "";
  }
  return names.length ? `Project / ${names.join(" / ")}` : "Project";
}

/** Project the facts the first read-only Properties dialog can honestly show.
 * Artifact and worksheet counts come from the node's direct canonical
 * children, so an Origin graph is counted only where the Library places it. */
export function workbookProperties(
  node: Extract<LibraryNode, { kind: "workbook" }>,
  folders: readonly FolderNode[],
): WorkbookProperties {
  const worksheets = node.children.filter((child) => child.kind === "worksheet");
  const onDemand = worksheets.filter((child) => child.entity.pending != null).length;
  const loaded = worksheets.length - onDemand;
  const tags = [...new Set(worksheets.flatMap((child) => child.entity.tags ?? []))];
  return {
    name: node.name,
    location: folderLocation(node.entity.folderId, folders),
    source: node.entity.source?.path ? "Linked source" : "No workbook source path recorded",
    sourcePath: node.entity.source?.path ?? null,
    originBook: node.entity.originBook ?? null,
    availability: worksheets.length === 0
      ? "No member worksheets"
      : onDemand
        ? `${loaded.toLocaleString()} loaded; ${onDemand.toLocaleString()} available on demand`
        : `${loaded.toLocaleString()} loaded`,
    worksheetCount: worksheets.length,
    artifactCount: node.children.length - worksheets.length,
    tags,
    importedAt: node.entity.importedAt ?? null,
  };
}
