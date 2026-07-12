// Pointer-mode SHAPE direct manipulation (MAIN #27) — wires the canvas
// plugin's bridge (lib/uplotShapes' shapesPlugin) to the store + the shape
// object menu (stroke/fill swatches, opacity/width/dash, pin to page/data,
// delete). Extracted out of PlotStage the same way useAnnotationEdit is
// (keep PlotStage under its line ceiling).

import { useEffect, useMemo, useState } from "react";

import { SERIES_VARS, cssVar, type BuildOptsArgs } from "../../lib/uplotOpts";
import { DEFAULT_SHAPE_WIDTH, resolveShapeOpacity, type ShapeAnchorConversion } from "../../lib/uplotShapes";
import { useApp } from "../../store/useApp";
import type { ContextMenuItem, Swatch } from "../overlays/ContextMenu";

const OPACITY_STEPS = [0.25, 0.5, 0.75, 1] as const;
const WIDTH_STEPS = [1, 2, 3] as const;

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
  const removeShape = useApp((s) => s.removeShape);
  const hasShapes = useApp((s) => s.shapes.length > 0);
  const [menu, setMenu] = useState<ShapeMenuState | null>(null);

  // Escape deselects (same window-keydown pattern as useAnnotationEdit's).
  useEffect(() => {
    if (!selectedShapeId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedShapeId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedShapeId, setSelectedShapeId]);

  // MAIN #27: flip a shape between "data" (moves with zoom/pan) and "page"
  // (canvas-fraction, resize-stable) anchoring, converting BOTH endpoints
  // IN PLACE from the plugin's precomputed `conv` — same reasoning as
  // useAnnotationEdit's togglePageAnchor.
  const togglePageAnchor = (id: string, conv: { toPage: ShapeAnchorConversion; toData: ShapeAnchorConversion }) => {
    const s = useApp.getState().shapes.find((x) => x.id === id);
    if (s?.anchor === "page") {
      updateShape(id, { anchor: "data", ...conv.toData });
    } else {
      updateShape(id, { anchor: "page", ...conv.toPage });
    }
  };

  const openMenu = (
    id: string,
    clientX: number,
    clientY: number,
    conv: { toPage: ShapeAnchorConversion; toData: ShapeAnchorConversion },
  ) => {
    const s = useApp.getState().shapes.find((x) => x.id === id);
    if (!s) return;
    const isPage = s.anchor === "page";
    const opacity = resolveShapeOpacity(s);
    const width = s.width ?? DEFAULT_SHAPE_WIDTH;
    const canFill = s.kind === "rect" || s.kind === "ellipse";
    // The "ink" swatch shows the app's general foreground token as a stand-in
    // (the REAL resolved plot ink color depends on this window's background
    // override, resolved only at draw/export time) — clicking it clears the
    // override so the shape reverts to that resolved ink color.
    const strokeSwatches: Swatch[] = [
      ...SERIES_VARS.map((tok, i) => ({
        key: tok,
        title: `Series ${i + 1}`,
        css: `var(${tok})`,
        active: s.stroke === tok,
        run: () => updateShape(id, { stroke: tok }),
      })),
      {
        key: "ink",
        title: "Annotation ink (default)",
        css: cssVar("--text") || "#eee",
        active: s.stroke == null,
        run: () => updateShape(id, { stroke: undefined }),
      },
    ];
    const fillSwatches: Swatch[] = [
      ...SERIES_VARS.map((tok, i) => ({
        key: tok,
        title: `Series ${i + 1}`,
        css: `var(${tok})`,
        active: s.fill === tok,
        run: () => updateShape(id, { fill: tok }),
      })),
      {
        key: "match-stroke",
        title: "Match stroke (default)",
        css: cssVar("--text") || "#eee",
        active: s.fill == null,
        run: () => updateShape(id, { fill: undefined }),
      },
    ];
    setMenu({
      x: clientX,
      y: clientY,
      items: [
        { header: `${s.kind[0].toUpperCase()}${s.kind.slice(1)}` },
        { header: "Stroke" },
        { swatches: strokeSwatches },
        ...(canFill ? ([{ header: "Fill" }, { swatches: fillSwatches }] as ContextMenuItem[]) : []),
        {
          label: "Opacity",
          submenu: OPACITY_STEPS.map((pct) => ({
            label: `${Math.round(pct * 100)}%`,
            checked: Math.abs(opacity - pct) < 1e-6,
            run: () => updateShape(id, { opacity: pct }),
          })),
        },
        {
          label: "Width",
          submenu: WIDTH_STEPS.map((w) => ({
            label: `${w} px`,
            checked: width === w,
            run: () => updateShape(id, { width: w }),
          })),
        },
        { label: "Dashed", checked: !!s.dash, run: () => updateShape(id, { dash: !s.dash }) },
        {
          label: isPage ? "Pin to data (follows zoom)" : "Pin to page (stays on zoom)",
          checked: isPage,
          run: () => togglePageAnchor(id, conv),
        },
        { separator: true },
        {
          label: "Delete",
          danger: true,
          run: () => {
            removeShape(id);
            setSelectedShapeId(null);
          },
        },
      ],
    });
  };

  const bridge = useMemo<NonNullable<BuildOptsArgs["shapeEdit"]> | null>(() => {
    if (tool !== "pointer" || !hasShapes) return null;
    return {
      selectedId: selectedShapeId,
      onSelect: setSelectedShapeId,
      onMove: (id, x1, y1, x2, y2) => updateShape(id, { x1, y1, x2, y2 }),
      onReshape: (id, patch) => updateShape(id, patch),
      onContextMenu: openMenu,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, hasShapes, selectedShapeId, setSelectedShapeId, updateShape]);

  return { bridge, menu, closeMenu: () => setMenu(null) };
}
