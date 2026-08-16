// Tree / Details / Tiles preference and focus continuity. Extracted from the
// Library component when PR E added the third renderer so the panel stays
// below the component ceiling; renderer components remain presentation-only.

import { useEffect, useRef, useState, type FocusEvent } from "react";

import type { FlatLibraryNode, LibraryHierarchy, LibraryNodeKey } from "../../lib/libraryHierarchy";
import {
  loadLibraryViewMode,
  saveLibraryViewMode,
  type LibraryViewMode,
} from "../../lib/libraryViewPrefs";
import { useApp } from "../../store/useApp";

interface Options {
  controlledMode?: LibraryViewMode;
  onModeChange?: (mode: LibraryViewMode) => void;
  hierarchy: LibraryHierarchy;
  rows: readonly FlatLibraryNode[];
  expandedFolders: readonly string[];
  expandedWorkbookIds: readonly string[];
  toggleFolderExpanded: (id: string) => void;
  toggleWorkbookExpanded: (id: string) => void;
}

export function useLibraryViewTransition(options: Options) {
  const [localMode, setLocalMode] = useState<LibraryViewMode>(loadLibraryViewMode);
  const mode = options.controlledMode ?? localMode;
  const pendingFocusKey = useRef<string | null>(null);
  const lastFocusedRowKey = useRef<string | null>(null);

  const changeMode = (next: LibraryViewMode): void => {
    // Tiles is a main-workspace action, so its already-selected control may
    // reopen the workspace after Escape returned to the plot.
    if (next === mode && next !== "tiles") return;
    const focused = document.activeElement?.closest?.("[data-lib-row], [data-ds-id]");
    const current = useApp.getState();
    const selectedKey = current.librarySelection
      ? `${current.librarySelection.kind}:${current.librarySelection.id}`
      : current.selectedIds[0]
        ? `worksheet:${current.selectedIds[0]}`
        : null;
    pendingFocusKey.current = focused?.getAttribute("data-lib-row")
      ?? (focused?.getAttribute("data-ds-id") ? `worksheet:${focused.getAttribute("data-ds-id")}` : null)
      ?? selectedKey
      ?? lastFocusedRowKey.current;

    // A Details row can select a child whose Tree ancestors are collapsed.
    if (next === "tree" && pendingFocusKey.current) {
      let parentKey = options.hierarchy.byKey.get(pendingFocusKey.current as LibraryNodeKey)?.parentKey ?? null;
      while (parentKey) {
        const parent = options.hierarchy.byKey.get(parentKey);
        if (!parent) break;
        if (parent.kind === "folder" && !options.expandedFolders.includes(parent.entityId)) {
          options.toggleFolderExpanded(parent.entityId);
        }
        if (parent.kind === "workbook" && !options.expandedWorkbookIds.includes(parent.entityId)) {
          options.toggleWorkbookExpanded(parent.entityId);
        }
        parentKey = parent.parentKey;
      }
    }
    if (options.onModeChange) options.onModeChange(next);
    else {
      saveLibraryViewMode(next);
      setLocalMode(next);
    }
  };

  // Preserve real keyboard focus across lazy renderer swaps. A few animation-
  // frame retries cover Suspense without stealing focus after the user moved.
  useEffect(() => {
    const key = pendingFocusKey.current;
    if (!key) return;
    let frame = 0;
    let attempts = 0;
    const tryFocus = (): void => {
      const selector = key.startsWith("worksheet:")
        ? `[data-ds-id="${CSS.escape(key.slice("worksheet:".length))}"]`
        : `[data-lib-row="${CSS.escape(key)}"]`;
      const target = document.querySelector(selector) as HTMLElement | null;
      if (target) {
        target.focus();
        pendingFocusKey.current = null;
      } else if (++attempts < 5) frame = requestAnimationFrame(tryFocus);
    };
    frame = requestAnimationFrame(tryFocus);
    return () => cancelAnimationFrame(frame);
  }, [mode, options.rows]);

  const rememberFocus = (event: FocusEvent<HTMLElement>): void => {
    const focused = (event.target as Element).closest("[data-lib-row], [data-ds-id]");
    if (!focused) return;
    lastFocusedRowKey.current = focused.getAttribute("data-lib-row")
      ?? (focused.getAttribute("data-ds-id") ? `worksheet:${focused.getAttribute("data-ds-id")}` : null);
  };

  return { viewMode: mode, changeViewMode: changeMode, rememberLibraryFocus: rememberFocus };
}
