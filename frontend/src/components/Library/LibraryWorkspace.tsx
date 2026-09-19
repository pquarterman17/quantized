// PR E: wide, main-workspace Tile browser. It consumes the same canonical
// hierarchy and open/select dispatchers as Tree and Details; it never invents
// a second Library model or mutates the active plot merely by browsing.
//
// L1.4 (2026-09-13): the grid is also a drag SOURCE and a drop TARGET, on the
// contract `useTileDragDrop.ts` documents (which is `useDetailsDragDrop`'s,
// unchanged — same payload types, same legality, same two store actions). One
// tile is one `LibraryTile`, extracted because a per-tile hook cannot be
// called from this `.map()`; every store read stayed here.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { plural } from "../../lib/plural";

import { requestDatasetRemoval } from "../../lib/datasetRemoval";
import { useEscapeSurface } from "../../lib/escapeStack";
import { needsScrollOutFocusFallback, scrollOutFocusProps } from "../../lib/scrollOutFocus";
import type { LibraryNode, LibraryNodeKey } from "../../lib/libraryHierarchy";
import { useApp } from "../../store/useApp";
import { useLibraryStore } from "../../store/hooks/useLibraryStore";
import type { LibrarySelection } from "../../store/libraryPanel";
import { openLibraryNode, opensInStage, selectLibraryNode } from "./libraryOpen";
import { deleteArtifactConfirmed, isArtifactNode } from "./artifactContextActions";
import { buildLibraryTileMenu } from "./libraryTileMenu";
import LibraryTile from "./LibraryTile";
import { focusTileWhenRendered, useTileVirtualization } from "./useTileVirtualization";
import { useTileDragDropContext } from "./useTileDragDrop";
import { useLibraryHierarchyModel } from "./useLibraryHierarchyRows";
import ContextMenu, { type ContextMenuItem } from "../overlays/ContextMenu";

interface Props {
  onClose: () => void;
}

// Pure — takes the two source fields as params instead of reading the store
// itself, so render-time call sites can pass their already-subscribed
// `useApp((s) => ...)` values (no untracked getState() read during render;
// see the two render-body call sites below) while imperative call sites
// (e.g. the close() callback) can still pass a fresh getState() snapshot.
function deriveSelectedKey(
  selection: LibrarySelection | null,
  selectedIds: readonly string[],
): LibraryNodeKey | null {
  if (selection) return `${selection.kind}:${selection.id}` as LibraryNodeKey;
  return selectedIds[0] ? `worksheet:${selectedIds[0]}` : null;
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
  // L1.4: ONE set of drag/drop store subscriptions for the whole grid, shared
  // by every rendered tile — the Details table's rule (a per-tile hook would
  // hold six subscriptions, so a 40-tile window would carry 240).
  const dndContext = useTileDragDropContext();
  const selection = useLibraryStore((s) => s.librarySelection);
  const selectedIds = useApp((s) => s.selectedIds);
  const initialKey = deriveSelectedKey(selection, selectedIds);
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
  const scrollRef = useRef<HTMLElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const virt = useTileVirtualization(items.length, scrollRef, gridRef);
  useEffect(() => {
    if (
      rovingKey != null
      && !items.some((node) => node.key === rovingKey)
      && document.activeElement === document.body
    ) {
      const prevIdx = prevItemsRef.current.findIndex((node) => node.key === rovingKey);
      const survivorIdx = Math.min(Math.max(prevIdx, 0), items.length - 1);
      const survivor = items[survivorIdx];
      if (survivor) {
        // E-c3: the survivor may be outside the rendered window — bring its
        // row in, then focus once it exists (rAF retry).
        virt.ensureVisible(survivorIdx);
        focusTileWhenRendered(survivor.key);
      }
    }
    prevItemsRef.current = items;
    // virt.ensureVisible is stable per (virtualized, refs) — not a re-run key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, rovingKey]);
  const currentSelectedKey = deriveSelectedKey(selection, selectedIds);
  const selectedInItems = items.some((node) => node.key === currentSelectedKey);
  const rovingInItems = items.some((node) => node.key === rovingKey);
  const tabStopKey = rovingInItems ? rovingKey : selectedInItems ? currentSelectedKey : items[0]?.key ?? null;
  // E-c3: the window must always contain exactly one tabbable tile — when
  // the model-level tab stop is scrolled out of the rendered window, the
  // first rendered tile carries the grid's keyboard entry point instead.
  const rendered = items.slice(virt.start, virt.end);
  const effectiveTabStop = rendered.some((node) => node.key === tabStopKey)
    ? tabStopKey
    : rendered[0]?.key ?? null;
  const breadcrumbs = useMemo(() => parentChain(container, hierarchy.byKey), [container, hierarchy.byKey]);

  const close = useCallback((): void => {
    // Imperative site (event handler, not render) — fresh getState() read is
    // correct here; deriveSelectedKey itself stays pure.
    const st = useApp.getState();
    const key = deriveSelectedKey(st.librarySelection, st.selectedIds);
    if (key) st.requestReveal(key);
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
  //
  // ROUND 3 (review findings 1+2): this used to be its own `document` listener
  // that `preventDefault()`ed EVERY Escape it saw, which outranked the only
  // keyboard dismissal a focused workshop has — with Tiles open, Escape closed
  // this workspace and left the panel on top of it stuck. It now takes its
  // place in the shared ordered registry (`lib/escapeStack.ts`) at the
  // `workspace` layer: a floating window in front of it claims the key first,
  // and the whole-app fallbacks behind it (the armed-plot-tool revert) only
  // ever see an Escape this workspace declined. The editing / command-palette
  // / open-menu guards are the dispatcher's now — one copy, one place — which
  // also retires the fifth hand-rolled `isEditing` predicate (review NIT 8).
  useEscapeSurface("workspace", () => {
    close();
    return true;
  });

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
    // `browse` doubles as the folder-reveal hook here: navigating the tile
    // workspace INTO a folder is exactly how a just-created subfolder becomes
    // visible, so Tiles needs no separate `expandFolder`.
    setMenu({ x, y, items: buildLibraryTileMenu(node, { browse: selectOrBrowse, open: openFromTile, stageReturn: close }) });
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

  // Delete/Backspace on a focused tile. Kept here, not in LibraryTile: the
  // worksheet branch needs the LIVE `selectedIds` (a focused tile inside the
  // multi-selection deletes the whole selection — roving focus moves without
  // changing selection, so the target must be named explicitly), and this is
  // an imperative event handler, the sanctioned place for a getState() read.
  const deleteFromTile = (node: LibraryNode): void => {
    if (node.kind === "worksheet") {
      const ids = useApp.getState().selectedIds;
      requestDatasetRemoval(ids.length > 0 && ids.includes(node.entityId) ? ids : [node.entityId]);
    } else if (isArtifactNode(node)) {
      // E-b2: the canonical registry delete (shared confirm + dependency
      // warning; fail-closed on recovered Origin figures, exactly like the
      // disabled menu item).
      deleteArtifactConfirmed(node);
    }
  };

  // E-c3: navigation is by MODEL index (the linear-list contract, #146),
  // not by querying rendered DOM — under virtualization the neighbor may
  // not exist yet, so ensureVisible brings its row in first and the focus
  // retries across the re-render.
  const moveFocus = (currentKey: LibraryNodeKey, delta: number): void => {
    const index = items.findIndex((node) => node.key === currentKey);
    if (index < 0) return;
    const target = Math.max(0, Math.min(items.length - 1, index + delta));
    virt.ensureVisible(target);
    focusTileWhenRendered(items[target].key, currentKey);
  };

  // E-c3 review fix: when the FOCUSED tile scrolls out of the rendered
  // window and unmounts, the browser drops focus to <body> and keyboard
  // interaction would dead-end. Hand focus to the grid container instead —
  // it never fights the user's scroll, and its own keydown (below) resumes
  // navigation from the roving tile's model position. The predicate (every
  // guard that used to be spelled out here) is now lib/scrollOutFocus's,
  // shared verbatim with Tree and Details.
  useEffect(() => {
    const selector = rovingKey != null ? `[data-library-tile="${CSS.escape(rovingKey)}"]` : null;
    const stillInModel = items.some((node) => node.key === rovingKey);
    if (needsScrollOutFocusFallback(virt.virtualized, selector, stillInModel)) gridRef.current?.focus();
  }, [virt.virtualized, virt.start, virt.end, items, rovingKey]);

  // Arrow/Enter while the GRID itself holds focus (the scroll-out fallback
  // above): resume from the roving tile's model position. Delete/Backspace
  // is CONSUMED, not acted on (focus-review fix, 2026-09-14): Tree and
  // Details already do this for their own scroll-out holder (the
  // lib/focusGuard.ts data-loss path — a focused plain container is not an
  // editing target, so an unconsumed Delete here would fall through to the
  // global selection-based removal and delete the stale `selectedIds` behind
  // a confirm, which is not what the scrolled-away roving tile is showing).
  const onGridKeyDown = (event: React.KeyboardEvent): void => {
    if (event.target !== gridRef.current) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      return;
    }
    if (rovingKey == null) return;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault(); moveFocus(rovingKey, 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault(); moveFocus(rovingKey, -1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const node = items.find((item) => item.key === rovingKey);
      if (node) openFromTile(node);
    }
  };

  // Entering ANY container (mount included — this runs for the null root
  // container too) lands the window on the current selection if it lives
  // here, else the top. This is also what resets a stale scrollTop carried
  // over from a previously-scrolled container — and it must run for SMALL
  // (unvirtualized) containers too: the browser only clamps a stale deep
  // scroll to the small container's own bottom, it never returns to the top.
  useEffect(() => {
    const index = currentSelectedKey ? items.findIndex((node) => node.key === currentSelectedKey) : -1;
    if (virt.virtualized) {
      virt.ensureVisible(Math.max(0, index));
      return;
    }
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    if (index > 0 && currentSelectedKey) {
      const tile = document.querySelector(`[data-library-tile="${CSS.escape(currentSelectedKey)}"]`);
      (tile as HTMLElement | null)?.scrollIntoView?.({ block: "nearest" });
    } else {
      scrollEl.scrollTop = 0;
    }
    // ensureVisible is stable; items/selection captured per container change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerKey, virt.virtualized]);

  return (
    <section className="qzk-library-workspace" aria-label="Library workspace" ref={scrollRef}>
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
        <span>{items.length} item{plural(items.length)}</span>
        <span>Single-click selects or browses · Double-click or Enter opens</span>
      </div>

      {items.length === 0 ? (
        <div className="qzk-library-workspace-empty">This location is empty.</div>
      ) : (
        <div
          className="qzk-tile-grid"
          role="list"
          aria-label={`${container?.name ?? "Project"} items`}
          ref={gridRef}
          {...scrollOutFocusProps}
          onKeyDown={onGridKeyDown}
          style={virt.virtualized ? { paddingTop: virt.padTop, paddingBottom: virt.padBottom } : undefined}
        >
          {rendered.map((node, renderedIndex) => (
            <LibraryTile
              key={node.key}
              node={node}
              selected={node.key === currentSelectedKey}
              tabStop={node.key === effectiveTabStop}
              setSize={items.length}
              posInSet={virt.start + renderedIndex + 1}
              dndContext={dndContext}
              onSelect={selectOrBrowse}
              onOpen={openFromTile}
              onFocus={setRovingKey}
              onMenu={openTileMenu}
              onDelete={deleteFromTile}
              onMoveFocus={moveFocus}
            />
          ))}
        </div>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </section>
  );
}
