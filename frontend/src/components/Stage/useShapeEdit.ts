// Pointer-mode SHAPE direct manipulation (MAIN #27) — wires the canvas
// plugin's bridge (lib/uplotShapes' shapesPlugin) to the store + the shape
// object menu (stroke/fill swatches, opacity/width/dash, pin to page/data,
// delete). Extracted out of PlotStage the same way useAnnotationEdit is
// (keep PlotStage under its line ceiling).
//
// GUI_INTERACTION #8 residual: the menu's fixed actions (Dashed, pin
// toggle, Delete) now come from the shared registry
// (`annotationShapeActions`) via `buildMenuItems` — defined once, reused by
// the ⌘K palette and the selection mini-toolbar. The swatch/opacity/width
// pickers (parameterized, not discrete actions) are hand-built. Both are
// built in ./objectMenus, loaded on demand (bundle diet slice 30).

import { useEffect, useMemo, useRef, useState } from "react";

import { useEscapeSurface } from "../../lib/escapeStack";
import type { BuildOptsArgs } from "../../lib/uplotOpts";
import { useApp } from "../../store/useApp";
import type { ContextMenuItem } from "../overlays/ContextMenu";
import type { ShapeConv } from "./annotationShapeActions";
import { cancelPendingObjectMenu, preloadObjectMenus, withObjectMenus } from "./objectMenusLoader";

export interface ShapeMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

export interface ShapeEditResult {
  /** Pass straight through to <PlotViewport shapeEdit={...}>; null outside
   *  pointer mode (or with no shapes) — buildOpts then leaves shapesPlugin
   *  non-interactive. */
  bridge: NonNullable<BuildOptsArgs["shapeEdit"]> | null;
  /** The object menu opened by a right-click on a shape; null = closed. */
  menu: ShapeMenuState | null;
  closeMenu: () => void;
}

export function useShapeEdit(tool: string): ShapeEditResult {
  const selectedShapeId = useApp((s) => s.selectedShapeId);
  const setSelectedShapeId = useApp((s) => s.setSelectedShapeId);
  const updateShape = useApp((s) => s.updateShape);
  const shapes = useApp((s) => s.shapes);
  const hasShapes = shapes.length > 0;
  const [menu, setMenu] = useState<ShapeMenuState | null>(null);

  // Escape deselects (same registry shape as useAnnotationEdit's). Round 4:
  // this was a bare window-keydown listener that did not `preventDefault`, so
  // it fired ALONGSIDE whatever else claimed the key — measured, one Escape
  // closed the Tiles workspace AND deselected the shape behind it. It is a
  // Stage selection, so it sits in the `selection` layer, below any open
  // surface; registering only while something IS selected keeps the decline
  // implicit and makes the most recent selection the one Escape clears.
  useEscapeSurface(
    "selection",
    () => {
      setSelectedShapeId(null);
      return true;
    },
    Boolean(selectedShapeId),
  );

  // The menu's items (the swatch/opacity/width pickers plus the registry
  // actions) are built in ./objectMenus, which loads on demand (bundle diet
  // slice 30). A shape that no longer exists opens no menu, and a gesture
  // that waited for that load is dropped if the tool has left pointer mode.
  const toolRef = useRef(tool);
  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);
  const openMenu = (id: string, clientX: number, clientY: number, conv: ShapeConv) =>
    withObjectMenus(
      (m) => {
        const items = m.shapeMenuItems(id, conv);
        if (items) setMenu({ x: clientX, y: clientY, items });
      },
      () => toolRef.current === "pointer",
    );

  const bridge = useMemo<NonNullable<BuildOptsArgs["shapeEdit"]> | null>(() => {
    if (tool !== "pointer" || !hasShapes) return null;
    return {
      selectedId: selectedShapeId,
      onSelect: setSelectedShapeId,
      onMove: (id, x1, y1, x2, y2) => {
        const s = shapes.find((x) => x.id === id);
        // an angle's second arm rides along with the move
        const arm = s && s.x3 !== undefined && s.y3 !== undefined ? { x3: s.x3 + x1 - s.x1, y3: s.y3 + y1 - s.y1 } : {};
        updateShape(id, { x1, y1, x2, y2, ...arm });
      },
      onReshape: (id, patch) => updateShape(id, patch),
      onContextMenu: openMenu,
    };
  }, [tool, hasShapes, shapes, selectedShapeId, setSelectedShapeId, updateShape]);

  // Warm the object menus once there is a shape to act on.
  useEffect(() => {
    if (bridge) preloadObjectMenus();
  }, [bridge]);

  return {
    bridge,
    menu,
    closeMenu: () => {
      cancelPendingObjectMenu();
      setMenu(null);
    },
  };
}
