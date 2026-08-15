// Pure projection/sort helpers for the Library Details renderer. The table
// consumes the SAME canonical LibraryHierarchy as Tree; sorting only a
// projected copy means a temporary Details sort can never rewrite the
// hierarchy's manual order.

import type { LibraryHierarchy, LibraryNode, LibraryNodeKind } from "./libraryHierarchy";

export type LibraryDetailsSortKey =
  | "manual"
  | "name"
  | "type"
  | "location"
  | "dimensions"
  | "dataType"
  | "source"
  | "modified"
  | "tags";
export type LibraryDetailsSortDirection = "asc" | "desc";

export interface LibraryDetailsRow {
  node: LibraryNode;
  manualIndex: number;
  type: string;
  location: string;
  dimensions: string;
  dataType: string;
  source: string;
  modified: string;
  tags: string;
}

const TYPE_LABELS: Record<LibraryNodeKind, string> = {
  folder: "Folder",
  workbook: "Workbook",
  worksheet: "Worksheet",
  "origin-figure": "Origin figure",
  "editable-figure": "Editable figure",
  "publication-figure": "Publication figure",
  page: "Figure page",
  report: "Report",
};

function flatten(nodes: readonly LibraryNode[], out: LibraryNode[]): void {
  for (const node of nodes) {
    out.push(node);
    flatten(node.children, out);
  }
}

function locationOf(node: LibraryNode, hierarchy: LibraryHierarchy): string {
  const names: string[] = [];
  const seen = new Set<string>();
  let parentKey = node.parentKey;
  while (parentKey && !seen.has(parentKey)) {
    seen.add(parentKey);
    const parent = hierarchy.byKey.get(parentKey);
    if (!parent) break;
    names.unshift(parent.name);
    parentKey = parent.parentKey;
  }
  return names.length > 0 ? names.join(" / ") : "Project";
}

function textMetadata(metadata: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "—";
}

function dimensionsOf(node: LibraryNode): string {
  if (node.kind !== "worksheet") return "—";
  const rows = node.entity.pending?.rows ?? node.entity.data.time.length;
  const columns = node.entity.pending?.cols ?? node.entity.data.labels.length;
  return `${rows.toLocaleString()} × ${columns.toLocaleString()}`;
}

function dataTypeOf(node: LibraryNode): string {
  if (node.kind !== "worksheet") return "—";
  const metadata = node.entity.data.metadata ?? {};
  const named = textMetadata(metadata, ["technique", "data_type", "parser", "format"]);
  if (named !== "—") return named;
  const match = /\.([^.]+)$/.exec(node.name);
  return match ? match[1].toUpperCase() : "Data";
}

function sourceOf(node: LibraryNode): string {
  if (node.kind === "origin-figure" && node.entity.datasetId == null) return "Unresolved";
  if (node.source.missingDatasetIds.length > 0) return "Missing data";
  if (node.kind === "worksheet") {
    if (node.entity.pending) return "On demand";
    return node.entity.source?.path ? "Linked file" : "Embedded";
  }
  if (node.kind === "workbook") return node.entity.source?.path ? "Linked file" : "Project";
  if (node.source.datasetIds.length > 0) return "Project data";
  return "Project";
}

function modifiedOf(node: LibraryNode): string {
  let value: string | undefined;
  if (node.kind === "worksheet" || node.kind === "workbook") value = node.entity.importedAt;
  else if (node.kind === "page") value = node.entity.modifiedAt;
  else if (node.kind === "report") value = node.entity.report.created ?? undefined;
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleDateString();
}

export function libraryDetailsRows(hierarchy: LibraryHierarchy): LibraryDetailsRow[] {
  const nodes: LibraryNode[] = [];
  flatten(hierarchy.roots, nodes);
  return nodes.map((node, manualIndex) => ({
    node,
    manualIndex,
    type: TYPE_LABELS[node.kind],
    location: locationOf(node, hierarchy),
    dimensions: dimensionsOf(node),
    dataType: dataTypeOf(node),
    source: sourceOf(node),
    modified: modifiedOf(node),
    tags: node.kind === "worksheet" ? (node.entity.tags ?? []).join(", ") || "—" : "—",
  }));
}

function valueOf(row: LibraryDetailsRow, key: LibraryDetailsSortKey): string | number {
  if (key === "manual") return row.manualIndex;
  if (key === "name") return row.node.name;
  return row[key];
}

export function sortLibraryDetailsRows(
  rows: readonly LibraryDetailsRow[],
  key: LibraryDetailsSortKey,
  direction: LibraryDetailsSortDirection,
): LibraryDetailsRow[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = valueOf(a, key);
    const bv = valueOf(b, key);
    const compared =
      typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" });
    return sign * compared || a.manualIndex - b.manualIndex;
  });
}
