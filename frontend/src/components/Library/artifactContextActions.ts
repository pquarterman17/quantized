// PR E-b2: one lifecycle menu contract for Library artifact nodes. Tiles,
// Tree artifact rows, and Details consume this builder so rename/duplicate/
// delete behavior and disabled reasons cannot drift by renderer.

import { openLibraryNode } from "./libraryOpen";
import { askParams } from "../overlays/ParamDialog";
import type { ContextMenuItem } from "../overlays/ContextMenu";
import { useApp } from "../../store/useApp";
import { buildMenuItems, runContextAction, type ContextAction, type MenuEntry } from "../../lib/contextActions";
import type { LibraryNode } from "../../lib/libraryHierarchy";
import { pagesReferencingFigure } from "../../lib/pageDocument";

export type ArtifactNode = Extract<
  LibraryNode,
  { kind: "origin-figure" | "editable-figure" | "publication-figure" | "page" | "report" }
>;

interface ArtifactTarget {
  node: ArtifactNode;
  open: () => void;
}

function renameArtifact(target: ArtifactTarget): void {
  const { node } = target;
  void askParams(`Rename "${node.name}"`, [
    { key: "name", label: "Name", type: "text", default: node.name },
  ]).then((result) => {
    const name = result && String(result.name).trim();
    if (!name) return;
    const state = useApp.getState();
    if (node.kind === "editable-figure") state.renameEditableFigure(node.entityId, name);
    else if (node.kind === "publication-figure") state.renameFigureDoc(node.entityId, name);
    else if (node.kind === "page") state.renamePageDocument(node.entityId, name);
    else if (node.kind === "report") state.renameReport(node.entityId, name);
  });
}

const canRename = (target: ArtifactTarget): boolean => target.node.kind !== "origin-figure";
const canDuplicate = (target: ArtifactTarget): boolean =>
  target.node.kind === "editable-figure" || target.node.kind === "publication-figure" || target.node.kind === "page";
const canDelete = canRename;

const artifactActions: MenuEntry<ArtifactTarget>[] = [
  {
    id: "artifact.open",
    label: "Open",
    enabled: (target) => target.node.kind !== "origin-figure" || target.node.entity.datasetId != null,
    disabledReason: () => "source workbook is unresolved",
    run: (target) => target.open(),
  },
  {
    id: "artifact.rename",
    label: "Rename…",
    enabled: canRename,
    disabledReason: () => "recovered Origin figure names come from the source project",
    run: renameArtifact,
  },
  {
    id: "artifact.duplicate",
    label: "Duplicate",
    enabled: canDuplicate,
    disabledReason: (target) => target.node.kind === "report"
      ? "report duplication is not available yet"
      : "recovered Origin figures are recreated from their source project",
    run: (target) => {
      const state = useApp.getState();
      if (target.node.kind === "editable-figure") state.duplicateEditableFigure(target.node.entityId);
      else if (target.node.kind === "publication-figure") state.duplicateFigureDoc(target.node.entityId);
      else if (target.node.kind === "page") state.duplicatePageDocument(target.node.entityId);
    },
  },
  {
    id: "artifact.saveAsTemplate",
    label: "Save as Template…",
    hidden: (target) => target.node.kind !== "editable-figure",
    enabled: () => false,
    // H5c (frozen contract): an honest disabled stub, not a second create
    // path. Reverse-mapping an arbitrary editable FigureDocument's bindings
    // back into a QuickFigureMapping is out of scope for PR H — a Quick Plot
    // template is captured from the BUILDER's own live (dataset, mapping,
    // style), never derived from a finished figure (see plan item H, "what
    // stays open under P1.3").
    disabledReason: () => "save a Quick Plot template from the Quick Figure Builder instead",
    run: () => {},
  },
  {
    id: "artifact.revealSource",
    label: "Show source in Library",
    enabled: (target) => target.node.source.datasetIds.length > 0,
    disabledReason: () => "no live source worksheet is available",
    run: (target) => useApp.getState().requestReveal(target.node.source.datasetIds[0]),
  },
  {
    id: "artifact.properties",
    label: "Properties…",
    enabled: () => false,
    disabledReason: () => "artifact properties arrive with the unified Properties panel",
    run: () => {},
  },
  { separator: true },
  {
    id: "artifact.delete",
    label: "Delete",
    destructive: true,
    enabled: canDelete,
    disabledReason: () => "recovered Origin figures are managed by their source import",
    confirm: (target) => {
      if (target.node.kind === "editable-figure") {
        const refs = pagesReferencingFigure(useApp.getState().pages, target.node.entityId);
        const affected = refs.length
          ? ` Used by ${refs.map((ref) => `"${ref.page.name}" (panel ${ref.labels.join(", ")})`).join("; ")}; those panels will show as missing.`
          : "";
        return { title: `Delete "${target.node.name}"?`, message: `The editable figure will be removed. Undo can restore it.${affected}`, confirmLabel: "Delete" };
      }
      if (target.node.kind === "page") {
        return { title: `Delete "${target.node.name}"?`, message: "The figure page will be removed. Undo can restore it.", confirmLabel: "Delete" };
      }
      return { title: `Delete "${target.node.name}"?`, message: "This artifact cannot be recovered unless it exists in a workspace you saved.", confirmLabel: "Delete" };
    },
    run: (target) => {
      const state = useApp.getState();
      if (target.node.kind === "editable-figure") state.deleteEditableFigure(target.node.entityId);
      else if (target.node.kind === "publication-figure") state.removeFigureDoc(target.node.entityId);
      else if (target.node.kind === "page") state.deletePageDocument(target.node.entityId);
      else if (target.node.kind === "report") state.removeReport(target.node.entityId);
    },
  },
];

export function isArtifactNode(node: LibraryNode): node is ArtifactNode {
  return node.kind === "origin-figure" || node.kind === "editable-figure" || node.kind === "publication-figure"
    || node.kind === "page" || node.kind === "report";
}

export function buildArtifactMenu(node: ArtifactNode, open: () => void = () => openLibraryNode(node)): ContextMenuItem[] {
  return buildMenuItems(artifactActions, { node, open });
}

/** Delete an artifact through the SAME registry action the lifecycle menu
 *  uses — looked up BY ID, mirroring `removeDatasetConfirmed` — so the
 *  shared confirm (and the page-panel dependency warning) cannot be
 *  bypassed by a Delete keystroke. Honors the action's own `enabled` gate
 *  (a keystroke must never confirm-then-no-op): a source-managed recovered
 *  Origin figure is a consumed no-op, exactly like its disabled menu item. */
export function deleteArtifactConfirmed(node: ArtifactNode): void {
  const action = artifactActions.find(
    (entry): entry is ContextAction<ArtifactTarget> => !("separator" in entry) && entry.id === "artifact.delete",
  );
  if (!action) throw new Error("artifact.delete missing from the artifact action registry");
  const target: ArtifactTarget = { node, open: () => openLibraryNode(node) };
  if (action.enabled && !action.enabled(target)) return;
  runContextAction(action, target);
}
