// PR E: wide, main-workspace Tile browser. It consumes the same canonical
// hierarchy and open/select dispatchers as Tree and Details; it never invents
// a second Library model or mutates the active plot merely by browsing.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isContextMenuKeyEvent } from "../../lib/contextActions";
import { requestDatasetRemoval } from "../../lib/datasetRemoval";
import { fmtNum } from "../../lib/format";
import type { LibraryNode, LibraryNodeKey } from "../../lib/libraryHierarchy";
import { libraryTileSummary } from "../../lib/libraryTileSummary";
import { useApp } from "../../store/useApp";
import { openLibraryNode, opensInStage, selectLibraryNode } from "./libraryOpen";
import { deleteArtifactConfirmed, isArtifactNode } from "./artifactContextActions";
import { buildLibraryTileMenu } from "./libraryTileMenu";
import { useThumbnail } from "./useThumbnail";
import { useLibraryHierarchyModel } from "./useLibraryHierarchyRows";
import ContextMenu, { type ContextMenuItem } from "../overlays/ContextMenu";

interface Props {
  onClose: () => void;
}

const KIND_LABEL: Record<LibraryNode["kind"], string> = {
  folder: "Folder",
  workbook: "Workbook",
  worksheet: "Worksheet",
  "origin-figure": "Origin figure",
  "editable-figure": "Editable figure",
  "publication-figure": "Publication figure",
  page: "Figure page",
  report: "Report",
};

const KIND_GLYPH: Record<LibraryNode["kind"], string> = {
  folder: "▰",
  workbook: "▤",
  worksheet: "▦",
  "origin-figure": "⌁",
  "editable-figure": "⌁",
  "publication-figure": "⌁",
  page: "▧",
  report: "≡",
};

function selectedKey(): LibraryNodeKey | null {
  const s = useApp.getState();
  if (s.librarySelection) return `${s.librarySelection.kind}:${s.librarySelection.id}` as LibraryNodeKey;
  return s.selectedIds[0] ? `worksheet:${s.selectedIds[0]}` : null;
}

function WorksheetPreview({ node }: { node: Extract<LibraryNode, { kind: "worksheet" }> }) {
  if (node.entity.pending) {
    return (
      <div className="qzk-tile-placeholder">
        <span aria-hidden="true">{KIND_GLYPH.worksheet}</span>
        <small>Data loads when opened</small>
      </div>
    );
  }
  const columnCount = Math.min(4, node.entity.data.labels.length || node.entity.data.values[0]?.length || 0);
  const labels = Array.from(
    { length: columnCount },
    (_, index) => node.entity.data.labels[index] || `Column ${index + 1}`,
  );
  const rows = node.entity.data.values.slice(0, 3);
  return (
    <div className="qzk-tile-table" aria-label={`Data preview for ${node.name}`}>
      <div className="qzk-tile-table-row head">
        {labels.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}
      </div>
      {rows.map((row, rowIndex) => (
        <div className="qzk-tile-table-row" key={rowIndex}>
          {Array.from({ length: columnCount }, (_, col) => (
            <span key={col}>{fmtNum(row[col])}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

function TilePreview({ node }: { node: LibraryNode }) {
  if (node.kind === "worksheet") return <WorksheetPreview node={node} />;
  if (node.kind === "folder" || node.kind === "workbook") {
    const children = node.children.length;
    return (
      <div className="qzk-tile-placeholder">
        <span aria-hidden="true">{KIND_GLYPH[node.kind]}</span>
        <small>{children} item{children === 1 ? "" : "s"}</small>
      </div>
    );
  }
  return <ArtifactPreview node={node} />;
}

/** E-c2: artifact tiles render through the canonical thumbnail pipe —
 *  visible-only generation, revision-keyed cache, abort on unmount (see
 *  useThumbnail), with a consistent visual language for every lifecycle
 *  state rather than renderer-specific placeholder copy. */
function ArtifactPreview({ node }: { node: LibraryNode }) {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const thumb = useThumbnail(node, holderRef);
  const missing = node.source.missingDatasetIds.length > 0;
  const caption = missing
    ? "Source unavailable"
    : thumb.status === "error"
      ? "Preview unavailable"
      : thumb.status === "unsupported"
        ? "Preview not available for this item"
        : thumb.status === "ready"
          ? null
          : "Generating preview…";
  return (
    <div className={`qzk-tile-placeholder qzk-artifact-preview is-${thumb.status}${missing ? " has-missing-source" : ""}`} ref={holderRef}>
      {thumb.status === "ready" ? (
        <img
          className="qzk-tile-thumb"
          src={thumb.result.url}
          width={thumb.result.width}
          height={thumb.result.height}
          alt={`Preview of ${node.name}`}
        />
      ) : (
        <>
          <span className="qzk-preview-kind" aria-hidden="true">{KIND_GLYPH[node.kind]}</span>
          {thumb.status === "loading" && <span className="qzk-preview-skeleton" aria-hidden="true" />}
        </>
      )}
      {caption && <small role={thumb.status === "error" ? "status" : undefined}>{caption}</small>}
      <span className="qzk-preview-badge" aria-hidden="true">{KIND_LABEL[node.kind]}</span>
    </div>
  );
}

function parentChain(node: LibraryNode | undefined, byKey: ReadonlyMap<LibraryNodeKey, LibraryNode>): LibraryNode[] {
  const chain: LibraryNode[] = [];
  let cursor = node;
  while (cursor) {
    chain.unshift(cursor);
    cursor = cursor.parentKey ? byKey.get(cursor.parentKey) : undefined;
  }
  return chain;
}

export default function LibraryWorkspace({ onClose }: Props) {
  const { hierarchy } = useLibraryHierarchyModel();
  const selection = useApp((s) => s.librarySelection);
  const selectedIds = useApp((s) => s.selectedIds);
  const initialKey = selectedKey();
  const initialNode = initialKey ? hierarchy.byKey.get(initialKey) : undefined;
  const [containerKey, setContainerKey] = useState<LibraryNodeKey | null>(() =>
    initialNode?.kind === "folder" || initialNode?.kind === "workbook" ? initialNode.key : initialNode?.parentKey ?? null,
  );
  const lastSelectionKey = useRef<LibraryNodeKey | null>(initialKey);
  const [rovingKey, setRovingKey] = useState<LibraryNodeKey | null>(initialKey);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

  // The still-visible sidebar tree is a navigator for this workspace. When
  // its current folder/workbook changes, show that container; selecting a
  // child keeps its containing overview visible.
  useEffect(() => {
    const key = selection
      ? (`${selection.kind}:${selection.id}` as LibraryNodeKey)
      : selectedIds[0]
        ? (`worksheet:${selectedIds[0]}` as LibraryNodeKey)
        : null;
    if (!key || key === lastSelectionKey.current) return;
    lastSelectionKey.current = key;
    const node = hierarchy.byKey.get(key);
    if (!node) return;
    const nextContainer = node.kind === "folder" || node.kind === "workbook" ? node.key : node.parentKey;
    if (nextContainer !== containerKey) setContainerKey(nextContainer);
  }, [selection, selectedIds, hierarchy, containerKey]);

  const container = containerKey ? hierarchy.byKey.get(containerKey) : undefined;
  const items = container ? container.children : hierarchy.roots;

  // Focus survives removal of the focused tile (the same contract as
  // LibraryTree/LibraryDetails rows, review round): when the tile that held
  // focus is gone after a re-render and the DOM orphaned focus to <body>,
  // land on the nearest surviving tile by its PREVIOUS position — never
  // steal focus that legitimately moved elsewhere.
  const prevItemsRef = useRef(items);
  useEffect(() => {
    if (
      rovingKey != null
      && !items.some((node) => node.key === rovingKey)
      && document.activeElement === document.body
    ) {
      const prevIdx = prevItemsRef.current.findIndex((node) => node.key === rovingKey);
      const survivor = items[Math.min(Math.max(prevIdx, 0), items.length - 1)];
      if (survivor) {
        (document.querySelector(`[data-library-tile="${CSS.escape(survivor.key)}"]`) as HTMLElement | null)?.focus();
      }
    }
    prevItemsRef.current = items;
  }, [items, rovingKey]);
  const currentSelectedKey = selectedKey();
  const selectedInItems = items.some((node) => node.key === currentSelectedKey);
  const rovingInItems = items.some((node) => node.key === rovingKey);
  const tabStopKey = rovingInItems ? rovingKey : selectedInItems ? currentSelectedKey : items[0]?.key ?? null;
  const breadcrumbs = useMemo(() => parentChain(container, hierarchy.byKey), [container, hierarchy.byKey]);

  const close = useCallback((): void => {
    const key = selectedKey();
    if (key) useApp.getState().requestReveal(key);
    onClose();
    if (!key) return;
    let attempts = 0;
    const restoreFocus = (): void => {
      const row = document.querySelector(`[data-lib-row="${CSS.escape(key)}"], [data-ds-id="${CSS.escape(key.replace(/^worksheet:/, ""))}"]`) as HTMLElement | null;
      if (row) row.focus();
      else if (++attempts < 5) requestAnimationFrame(restoreFocus);
    };
    requestAnimationFrame(restoreFocus);
  }, [onClose]);

  // The narrow tree intentionally remains interactive while Tiles occupies
  // the Stage. Escape therefore belongs to the whole workspace session, not
  // only descendants of the tile section: focus may still be on the sidebar
  // Tiles button or a tree row when the user presses it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Same editing predicate as useGlobalShortcuts' isEditing (review round:
      // SELECT was missing, and isContentEditable covers every contenteditable
      // form, not only the ="true" spelling).
      const el = event.target instanceof HTMLElement ? event.target : null;
      const editing = !!el
        && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if (useApp.getState().cmdkOpen || document.querySelector(".qzk-ctx") || editing) return;
      event.preventDefault();
      // This workspace owns the keystroke. Do not also let the window-level
      // plot-tool Escape handler clear an unchanged plot gesture/tool.
      event.stopPropagation();
      close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [close]);

  const selectOrBrowse = (node: LibraryNode): void => {
    selectLibraryNode(node);
    if (node.kind === "folder" || node.kind === "workbook") setContainerKey(node.key);
  };

  const openTileMenu = (node: LibraryNode, x: number, y: number): void => {
    // The tree's selectForMenu contract (DatasetRow): a right-click on a tile
    // ALREADY inside the multi-selection keeps that selection, so the bulk
    // actions (Remove N selected, merge, panels) stay reachable and the menu
    // agrees with the tile Delete key's enclosing-selection rule. Any other
    // tile is selected first, same as the tree.
    const alreadyInSelection =
      node.kind === "worksheet" && useApp.getState().selectedIds.includes(node.entityId);
    if (!alreadyInSelection) selectLibraryNode(node);
    const menuItems = buildLibraryTileMenu(node, { browse: selectOrBrowse, open: openFromTile, stageReturn: close });
    if (menuItems) setMenu({ x, y, items: menuItems });
  };

  // OWNER DECISION (Paige, 2026-08-16, PR #145 review follow-up): an open
  // whose visible result is a Stage plot (worksheet activation, Origin
  // figure, editable-figure window, or a workbook resolving to one) also
  // RETURNS to the plot — otherwise the open changes the plot invisibly
  // behind this workspace and the user sees only a selection tint. Overlay
  // opens (pages, reports, publication figures) render above the tiles and
  // deliberately keep the workspace open. Recorded in
  // LIBRARY_WORKBOOK_UX_PLAN's change log alongside `opensInStage`'s note.
  const openFromTile = (node: LibraryNode): void => {
    openLibraryNode(node);
    if (opensInStage(node)) close();
  };

  const moveFocus = (current: HTMLElement, delta: number): void => {
    const tiles = [...current.closest(".qzk-tile-grid")!.querySelectorAll<HTMLElement>("[data-library-tile]")];
    const index = tiles.indexOf(current);
    tiles[Math.max(0, Math.min(tiles.length - 1, index + delta))]?.focus();
  };

  return (
    <section className="qzk-library-workspace" aria-label="Library workspace">
      <header className="qzk-library-workspace-head">
        <div>
          <div className="qzk-library-workspace-eyebrow">Library</div>
          <h1>{container?.name ?? "Project"}</h1>
          <nav className="qzk-library-breadcrumbs" aria-label="Library location">
            <button type="button" onClick={() => setContainerKey(null)}>Project</button>
            {breadcrumbs.map((node) => (
              <span key={node.key}>
                <span aria-hidden="true">/</span>
                <button type="button" onClick={() => setContainerKey(node.key)}>{node.name}</button>
              </span>
            ))}
          </nav>
        </div>
        <button type="button" className="qzk-library-return" onClick={close} title="Return to the unchanged active plot (Esc)">
          ← Back to plot <kbd>Esc</kbd>
        </button>
      </header>

      <div className="qzk-library-workspace-summary">
        <span>{items.length} item{items.length === 1 ? "" : "s"}</span>
        <span>Single-click selects or browses · Double-click or Enter opens</span>
      </div>

      {items.length === 0 ? (
        <div className="qzk-library-workspace-empty">This location is empty.</div>
      ) : (
        <div className="qzk-tile-grid" role="list" aria-label={`${container?.name ?? "Project"} items`}>
          {items.map((node) => {
            const selected = node.key === currentSelectedKey;
            const summary = libraryTileSummary(node);
            return (
              <article
                key={node.key}
                role="listitem"
                data-library-tile={node.key}
                className={`qzk-library-tile${selected ? " selected" : ""}`}
                tabIndex={node.key === tabStopKey ? 0 : -1}
                aria-label={`${node.name}, ${KIND_LABEL[node.kind]}`}
                onClick={() => selectOrBrowse(node)}
                onDoubleClick={() => openFromTile(node)}
                onFocus={() => setRovingKey(node.key)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  openTileMenu(node, event.clientX, event.clientY);
                }}
                onKeyDown={(event) => {
                  if (isContextMenuKeyEvent(event)) {
                    event.preventDefault();
                    const rect = event.currentTarget.getBoundingClientRect();
                    openTileMenu(node, rect.left + 8, rect.bottom);
                  } else if (event.key === "Enter") {
                    event.preventDefault();
                    openFromTile(node);
                  } else if (event.key === "Delete" || event.key === "Backspace") {
                    event.preventDefault();
                    if (node.kind === "worksheet") {
                      const ids = useApp.getState().selectedIds;
                      requestDatasetRemoval(ids.length > 0 && ids.includes(node.entityId) ? ids : [node.entityId]);
                    } else if (isArtifactNode(node)) {
                      // E-b2: the canonical registry delete (shared confirm +
                      // dependency warning; fail-closed on recovered Origin
                      // figures, exactly like the disabled menu item).
                      deleteArtifactConfirmed(node);
                    }
                  } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                    event.preventDefault(); moveFocus(event.currentTarget, 1);
                  } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                    event.preventDefault(); moveFocus(event.currentTarget, -1);
                  }
                }}
              >
                <TilePreview node={node} />
                <div className="qzk-library-tile-copy">
                  <strong title={node.name}>{node.name}</strong>
                  <span>{KIND_LABEL[node.kind]} · {summary.primary}</span>
                  {summary.secondary && <span>{summary.secondary}</span>}
                  {summary.warning && <em>{summary.warning}</em>}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </section>
  );
}
