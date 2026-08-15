// Canonical, renderer-independent Library hierarchy. Tree, Tiles, Details,
// search, keyboard navigation, and drag/drop should consume this same model so
// changing views cannot change where an item appears or how it is identified.

import type { FigureDoc } from "./figuredoc";
import type { FigureDocument } from "./figureDocument";
import { originSheetNumber } from "./grouping";
import { byOrder } from "./order";
import { figureLabel, figureLayerFamily, type OriginFigureEntry } from "./originFigures";
import type { PageDocument } from "./pageDocument";
import type { ReportEntry } from "./report";
import type { Dataset, FolderNode } from "./types";
import type { WorkbookNode } from "./workbooks";

export type LibraryNodeKind =
  | "folder"
  | "workbook"
  | "worksheet"
  | "origin-figure"
  | "editable-figure"
  | "publication-figure"
  | "page"
  | "report";

export type LibraryNodeKey = `${LibraryNodeKind}:${string}`;

export interface LibrarySourceStatus {
  datasetIds: readonly string[];
  missingDatasetIds: readonly string[];
  /** A recovered Origin figure may use a surviving import sibling only to
   * place an unresolved item; that does not claim the sibling is its source. */
  usedPlacementFallback: boolean;
}

interface LibraryNodeBase {
  key: LibraryNodeKey;
  entityId: string;
  kind: LibraryNodeKind;
  name: string;
  parentKey: LibraryNodeKey | null;
  depth: number;
  children: readonly LibraryNode[];
  source: LibrarySourceStatus;
}

export type LibraryNode =
  | (LibraryNodeBase & { kind: "folder"; entity: FolderNode })
  | (LibraryNodeBase & { kind: "workbook"; entity: WorkbookNode })
  | (LibraryNodeBase & { kind: "worksheet"; entity: Dataset })
  | (LibraryNodeBase & { kind: "origin-figure"; entity: OriginFigureEntry })
  | (LibraryNodeBase & { kind: "editable-figure"; entity: FigureDocument })
  | (LibraryNodeBase & { kind: "publication-figure"; entity: FigureDoc })
  | (LibraryNodeBase & { kind: "page"; entity: PageDocument })
  | (LibraryNodeBase & { kind: "report"; entity: ReportEntry });

export interface LibraryHierarchyInput {
  folders: readonly FolderNode[];
  workbooks: readonly WorkbookNode[];
  datasets: readonly Dataset[];
  originFigures?: readonly OriginFigureEntry[];
  editableFigures?: readonly FigureDocument[];
  publicationFigures?: readonly FigureDoc[];
  pages?: readonly PageDocument[];
  reports?: readonly ReportEntry[];
}

export interface LibraryHierarchy {
  roots: readonly LibraryNode[];
  byKey: ReadonlyMap<LibraryNodeKey, LibraryNode>;
  warnings: readonly string[];
}

interface DraftNode extends Omit<LibraryNodeBase, "children"> {
  entity: FolderNode | WorkbookNode | Dataset | OriginFigureEntry | FigureDocument | FigureDoc | PageDocument | ReportEntry;
  children: DraftNode[];
  section: number;
  /** The entity's own sort key where one exists (folders/workbooks/
   *  worksheets), else a synthetic insertion index (artifact kinds). KEPT
   *  optional so lib/order.ts's `byOrder` applies its canonical semantics:
   *  an unkeyed item sinks AFTER every keyed sibling — the invariant PR A4's
   *  append path relies on for "appended lands at the end", and what today's
   *  foldertree-driven Library already does. Never substitute an array index
   *  for a missing key; that interleaves instead of sinking. */
  order: number | undefined;
  /** Kind-specific ordering between `byOrder` and insertion order. Origin
   *  sheets use their sheet number (L0.16 source order) because the backend's
   *  book fan-out order is NOT guaranteed — the same reason
   *  lib/grouping.ts's `originSheetGroups` sorts by sheet number. Every
   *  other kind passes 0, making this a no-op for them. A user-keyed
   *  `order` still outranks it (byOrder compares first). */
  tiebreak: number;
  sequence: number;
}

const keyOf = (kind: LibraryNodeKind, id: string): LibraryNodeKey => `${kind}:${id}`;
const EMPTY_SOURCE: LibrarySourceStatus = {
  datasetIds: [],
  missingDatasetIds: [],
  usedPlacementFallback: false,
};

function compareDraft(a: DraftNode, b: DraftNode): number {
  // Section first (kind bands), then the app's canonical order comparator
  // (keyed ascending, unkeyed sinks last), then the kind-specific tiebreak
  // (Origin sheet number — see DraftNode.tiebreak), then insertion order —
  // the same stable result `byOrder` + a stable sort gives the existing
  // Library.
  return a.section - b.section || byOrder(a, b) || a.tiebreak - b.tiebreak || a.sequence - b.sequence;
}

/** Dataset ids used by an Origin graph, scoped to the siblings from the same
 * import. This mirrors application-time source resolution, including layers
 * belonging to one graph window, without treating every sibling as a source. */
function originSourceIds(
  entry: OriginFigureEntry,
  figures: readonly OriginFigureEntry[],
  datasets: readonly Dataset[],
): string[] {
  const siblingSet = new Set(entry.siblingIds);
  const family = figureLayerFamily(entry, [...figures]);
  const relevant = family.length > 0 ? family : [entry];
  const ids = new Set<string>();
  const books = new Set<string>();
  for (const member of relevant) {
    if (member.datasetId && siblingSet.has(member.datasetId)) ids.add(member.datasetId);
    for (const curve of member.figure.curves ?? []) books.add(curve.book);
  }
  for (const dataset of datasets) {
    if (!siblingSet.has(dataset.id)) continue;
    const book = String((dataset.data.metadata ?? {}).origin_book ?? "");
    if (books.has(book)) ids.add(dataset.id);
  }
  return [...ids];
}

function commonFolderId(
  workbookIds: readonly string[],
  workbookById: ReadonlyMap<string, WorkbookNode>,
  folderById: ReadonlyMap<string, FolderNode>,
): string | null {
  const paths = workbookIds.map((id) => {
    const path: string[] = [];
    const seen = new Set<string>();
    let current = workbookById.get(id)?.folderId;
    while (current && !seen.has(current)) {
      const folder = folderById.get(current);
      if (!folder) break;
      seen.add(current);
      path.unshift(current);
      current = folder.parentId ?? undefined;
    }
    return path;
  });
  if (paths.length === 0) return null;
  let common: string | null = null;
  const limit = Math.min(...paths.map((path) => path.length));
  for (let i = 0; i < limit; i++) {
    if (paths.every((path) => path[i] === paths[0][i])) common = paths[0][i];
    else break;
  }
  return common;
}

/** Build the one structural truth consumed by every Library presentation. */
export function buildLibraryHierarchy(input: LibraryHierarchyInput): LibraryHierarchy {
  const warnings: string[] = [];
  const drafts = new Map<LibraryNodeKey, DraftNode>();
  const folderById = new Map(input.folders.map((folder) => [folder.id, folder]));
  const workbookById = new Map(input.workbooks.map((workbook) => [workbook.id, workbook]));
  const datasetById = new Map(input.datasets.map((dataset) => [dataset.id, dataset]));
  let sequence = 0;

  const add = (
    kind: LibraryNodeKind,
    entity: DraftNode["entity"],
    name: string,
    parentKey: LibraryNodeKey | null,
    section: number,
    order: number | undefined,
    source: LibrarySourceStatus = EMPTY_SOURCE,
    tiebreak = 0,
  ): DraftNode => {
    const key = keyOf(kind, entity.id);
    const node: DraftNode = {
      key, entityId: entity.id, kind, name, parentKey, depth: 0,
      children: [], source, section, order, tiebreak, sequence: sequence++, entity,
    };
    if (drafts.has(key)) warnings.push(`duplicate ${kind} id "${entity.id}"; last item won`);
    drafts.set(key, node);
    return node;
  };

  input.folders.forEach((folder) => {
    let parentKey: LibraryNodeKey | null = null;
    const seen = new Set([folder.id]);
    let ancestorId = folder.parentId;
    let invalidCycle = false;
    while (ancestorId) {
      if (seen.has(ancestorId)) {
        invalidCycle = true;
        warnings.push(`folder "${folder.name}" has a cyclic parent chain; placed at root`);
        break;
      }
      seen.add(ancestorId);
      ancestorId = folderById.get(ancestorId)?.parentId ?? null;
    }
    if (!invalidCycle && folder.parentId && folderById.has(folder.parentId)) {
      parentKey = keyOf("folder", folder.parentId);
    } else if (!invalidCycle && folder.parentId) {
      warnings.push(`folder "${folder.name}" referenced missing parent "${folder.parentId}"; placed at root`);
    }
    add("folder", folder, folder.name, parentKey, 0, folder.order);
  });

  input.workbooks.forEach((workbook) => {
    const parentKey = workbook.folderId && folderById.has(workbook.folderId)
      ? keyOf("folder", workbook.folderId)
      : null;
    if (workbook.folderId && !folderById.has(workbook.folderId)) {
      warnings.push(`workbook "${workbook.name}" referenced missing folder "${workbook.folderId}"; placed at root`);
    }
    add("workbook", workbook, workbook.name, parentKey, 1, workbook.order);
  });

  input.datasets.forEach((dataset) => {
    const validWorkbook = dataset.workbookId && workbookById.has(dataset.workbookId);
    const parentKey = validWorkbook ? keyOf("workbook", dataset.workbookId!) : null;
    if (dataset.workbookId && !validWorkbook) {
      warnings.push(`worksheet "${dataset.name}" referenced missing workbook "${dataset.workbookId}"; placed at root`);
    }
    add("worksheet", dataset, dataset.name, parentKey, 0, dataset.order, {
      datasetIds: [dataset.id], missingDatasetIds: [], usedPlacementFallback: false,
    }, originSheetNumber(dataset));
  });

  const ownerForSources = (requestedIds: readonly string[], fallbackIds: readonly string[] = []) => {
    const datasetIds = [...new Set(requestedIds.filter((id) => datasetById.has(id)))];
    const missingDatasetIds = [...new Set(requestedIds.filter((id) => !datasetById.has(id)))];
    const workbookIds = [...new Set(datasetIds.map((id) => datasetById.get(id)?.workbookId)
      .filter((id): id is string => Boolean(id && workbookById.has(id))))];
    let parentKey: LibraryNodeKey | null = null;
    if (workbookIds.length === 1) parentKey = keyOf("workbook", workbookIds[0]);
    else if (workbookIds.length > 1) {
      const folderId = commonFolderId(workbookIds, workbookById, folderById);
      parentKey = folderId ? keyOf("folder", folderId) : null;
    }
    let usedPlacementFallback = false;
    if (datasetIds.length === 0) {
      const fallback = fallbackIds.find((id) => datasetById.has(id));
      const workbookId = fallback ? datasetById.get(fallback)?.workbookId : undefined;
      if (workbookId && workbookById.has(workbookId)) {
        parentKey = keyOf("workbook", workbookId);
        usedPlacementFallback = true;
      }
    }
    return { parentKey, source: { datasetIds, missingDatasetIds, usedPlacementFallback } };
  };

  // Artifact sections start at 2, DISJOINT from workbooks (section 1): a
  // cross-workbook artifact placed at a shared folder must follow the
  // folder's workbooks, never interleave with them. Inside a workbook the
  // L0.16 band order is unchanged (worksheets 0, then figures, pages,
  // reports). Artifacts pass their insertion index as `order` — every
  // artifact is keyed, so byOrder keeps them insertion-ordered.
  (input.originFigures ?? []).forEach((figure, index) => {
    const sourceIds = originSourceIds(figure, input.originFigures ?? [], input.datasets);
    const owner = ownerForSources(sourceIds, figure.siblingIds);
    add("origin-figure", figure, figureLabel(figure), owner.parentKey, 2, index, owner.source);
  });
  (input.editableFigures ?? []).forEach((figure, index) => {
    const owner = ownerForSources(figure.bindings.datasetId ? [figure.bindings.datasetId] : []);
    add("editable-figure", figure, figure.name, owner.parentKey, 3, index, owner.source);
  });
  (input.publicationFigures ?? []).forEach((figure, index) => {
    const owner = ownerForSources(figure.datasetId ? [figure.datasetId] : []);
    add("publication-figure", figure, figure.name, owner.parentKey, 4, index, owner.source);
  });

  const editableById = new Map((input.editableFigures ?? []).map((figure) => [figure.id, figure]));
  (input.pages ?? []).forEach((page, index) => {
    const sourceIds: string[] = [];
    const missingFigureIds: string[] = [];
    for (const panel of page.panels) {
      if (!panel.figureId) continue;
      const figure = editableById.get(panel.figureId);
      if (!figure) missingFigureIds.push(panel.figureId);
      else if (figure.bindings.datasetId) sourceIds.push(figure.bindings.datasetId);
    }
    const owner = ownerForSources(sourceIds);
    if (missingFigureIds.length > 0) {
      warnings.push(`page "${page.name}" referenced missing figure(s): ${[...new Set(missingFigureIds)].join(", ")}`);
    }
    add("page", page, page.name, owner.parentKey, 5, index, owner.source);
  });
  (input.reports ?? []).forEach((report, index) => {
    const owner = ownerForSources(report.datasetId ? [report.datasetId] : []);
    add("report", report, report.name, owner.parentKey, 6, index, owner.source);
  });

  const roots: DraftNode[] = [];
  for (const node of drafts.values()) {
    const parent = node.parentKey ? drafts.get(node.parentKey) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  const finalize = (node: DraftNode, depth: number, ancestors: ReadonlySet<LibraryNodeKey>): LibraryNode => {
    if (ancestors.has(node.key)) {
      warnings.push(`cycle at ${node.key}; descendants omitted`);
      return { ...node, depth, children: [] } as LibraryNode;
    }
    const nextAncestors = new Set(ancestors).add(node.key);
    const children = [...node.children].sort(compareDraft).map((child) => finalize(child, depth + 1, nextAncestors));
    return { ...node, depth, children } as LibraryNode;
  };
  const finalRoots = roots.sort(compareDraft).map((root) => finalize(root, 0, new Set()));
  const byKey = new Map<LibraryNodeKey, LibraryNode>();
  const indexNodes = (nodes: readonly LibraryNode[]) => nodes.forEach((node) => {
    byKey.set(node.key, node);
    indexNodes(node.children);
  });
  indexNodes(finalRoots);
  return { roots: finalRoots, byKey, warnings };
}

export interface FlatLibraryNode {
  node: LibraryNode;
  hasChildren: boolean;
  expanded: boolean;
}

/** Flatten visible rows without rebuilding ownership. Expansion uses canonical
 * keys, so equal entity ids in different kinds cannot collide. */
export function flattenLibraryHierarchy(
  hierarchy: LibraryHierarchy,
  expandedKeys: ReadonlySet<LibraryNodeKey>,
): FlatLibraryNode[] {
  const rows: FlatLibraryNode[] = [];
  const visit = (nodes: readonly LibraryNode[]) => nodes.forEach((node) => {
    const hasChildren = node.children.length > 0;
    const expanded = hasChildren && expandedKeys.has(node.key);
    rows.push({ node, hasChildren, expanded });
    if (expanded) visit(node.children);
  });
  visit(hierarchy.roots);
  return rows;
}
