// Pointer-mode annotation direct manipulation (MAIN #18) — wires the canvas
// plugin's bridge (lib/uplotOverlays' interactive annotationPlugin) to the
// store + the annotation text editor. Extracted out of PlotStage to keep
// that component under its line ceiling — the same reasoning as
// useGadgetChip/useAxisDrop/usePlotStageActions.
//
// GUI_INTERACTION #8 residual: the menu's fixed actions (Edit text, pin
// toggle, Size +/−, Delete) now come from the shared registry
// (`annotationShapeActions`) via `buildMenuItems` — defined once, reused by
// the ⌘K palette and the selection mini-toolbar. Only the Frame submenu (a
// parameterized picker, not a discrete action) is hand-built. Both are built
// in ./objectMenus, loaded on demand (bundle diet slice 30).

import { useEffect, useMemo, useState } from "react";

import { useEscapeSurface } from "../../lib/escapeStack";
import type { BuildOptsArgs } from "../../lib/uplotOpts";
import { useApp } from "../../store/useApp";
import type { ContextMenuItem } from "../overlays/ContextMenu";
import type { AnnotationConv } from "./annotationShapeActions";
import { preloadObjectMenus, withObjectMenus } from "./objectMenusLoader";

export interface AnnotationMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

export interface AnnotationEditResult {
  /** Pass straight through to <PlotViewport annotationEdit={...}>; null
   *  outside pointer mode (or with no annotations) — buildOpts then leaves
   *  annotationPlugin non-interactive, exactly as before this feature. */
  bridge: NonNullable<BuildOptsArgs["annotationEdit"]> | null;
  /** The object menu opened by a right-click on an annotation; null = closed. */
  menu: AnnotationMenuState | null;
  closeMenu: () => void;
}

export function useAnnotationEdit(tool: string): AnnotationEditResult {
  const selectedAnnotationId = useApp((s) => s.selectedAnnotationId);
  const setSelectedAnnotationId = useApp((s) => s.setSelectedAnnotationId);
  const updateAnnotation = useApp((s) => s.updateAnnotation);
  const hasAnnotations = useApp((s) => s.annotations.length > 0);
  const [menu, setMenu] = useState<AnnotationMenuState | null>(null);

  // Escape deselects — registered only while something IS selected. Round 4:
  // this was a bare window-keydown listener that did not `preventDefault`, so
  // it fired ALONGSIDE whatever else claimed the key (one Escape, two
  // actions). A Stage selection sits in the `selection` layer, below any open
  // surface and above the whole-app tool revert.
  useEscapeSurface(
    "selection",
    () => {
      setSelectedAnnotationId(null);
      return true;
    },
    Boolean(selectedAnnotationId),
  );

  // The menu's items (the registry actions plus the Frame picker) are built
  // in ./objectMenus, which loads on demand (bundle diet slice 30).
  const openMenu = (id: string, clientX: number, clientY: number, conv: AnnotationConv) =>
    withObjectMenus((m) => setMenu({ x: clientX, y: clientY, items: m.annotationMenuItems(id, conv) }));

  // Stable across annotation content edits (MAIN #8f reasoning): only the
  // tool switching in/out of pointer mode, or the list going empty<->non-
  // empty, needs a fresh bridge identity — every store action referenced
  // below is a stable Zustand action reference for the store's lifetime.
  const bridge = useMemo<NonNullable<BuildOptsArgs["annotationEdit"]> | null>(() => {
    if (tool !== "pointer" || !hasAnnotations) return null;
    return {
      selectedId: selectedAnnotationId,
      onSelect: setSelectedAnnotationId,
      onMove: (id, x, y) => updateAnnotation(id, { x, y }),
      onResize: (id, size) => updateAnnotation(id, { size }),
      onEditText: (id) => withObjectMenus((m) => m.editAnnotationText(id)),
      onContextMenu: openMenu,
      // Empty-canvas double-click → reset zoom (owner ask 2026-07-11). The
      // store half: clear committed limits so an applied Origin figure's
      // fixed ranges release too; the plugin itself re-autoscales uPlot's
      // internal scales for limit-less box zooms.
      onResetView: () => {
        const st = useApp.getState();
        st.setXLim(null);
        st.setYLim(null);
        st.setY2Lim(null);
      },
    };
  }, [tool, hasAnnotations, selectedAnnotationId, setSelectedAnnotationId, updateAnnotation]);

  // Warm the object menus once there is an annotation to act on.
  useEffect(() => {
    if (bridge) preloadObjectMenus();
  }, [bridge]);

  return { bridge, menu, closeMenu: () => setMenu(null) };
}
