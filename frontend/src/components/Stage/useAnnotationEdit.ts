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
// parameterized picker, not a discrete action) stays hand-built here.

import { useEffect, useMemo, useState } from "react";

import { buildMenuItems } from "../../lib/contextActions";
import { cssVar, type BuildOptsArgs } from "../../lib/uplotOpts";
import type { Annotation } from "../../lib/types";
import { useApp } from "../../store/useApp";
import type { ContextMenuItem } from "../overlays/ContextMenu";
import {
  annotationDeleteAction,
  annotationEditActions,
  annotationSizeActions,
  editAnnotationText,
  type AnnotationConv,
} from "./annotationShapeActions";

/** MAIN #27 "text box" Frame opacity submenu steps — same 25/50/75/100%
 *  shape as the Shape object menu's Opacity submenu (`useShapeEdit`). */
const FRAME_OPACITY_STEPS = [0.25, 0.5, 0.75, 1] as const;

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

  // Escape deselects (same window-keydown pattern as useGadgetChip's
  // Escape-dismiss) — only listens while something IS selected.
  useEffect(() => {
    if (!selectedAnnotationId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedAnnotationId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedAnnotationId, setSelectedAnnotationId]);

  // MAIN #27 "text box": set/replace the frame wholesale (a preset click) or
  // patch just its opacity (the Opacity submenu, preserving any existing
  // fill/stroke — e.g. Solid + a later opacity pick keeps the surface fill).
  const setFrame = (id: string, frame: Annotation["frame"]) => updateAnnotation(id, { frame });
  const setFrameOpacity = (id: string, opacity: number) => {
    const a = useApp.getState().annotations.find((x) => x.id === id);
    updateAnnotation(id, { frame: { ...(a?.frame ?? {}), opacity } });
  };

  const openMenu = (id: string, clientX: number, clientY: number, conv: AnnotationConv) => {
    const a = useApp.getState().annotations.find((x) => x.id === id);
    const frameOpacity = a?.frame?.opacity ?? 1;
    const target = { id, conv };
    setMenu({
      x: clientX,
      y: clientY,
      items: [
        { header: a?.text || "Annotation" },
        ...buildMenuItems(annotationEditActions, target),
        // Frame: a parameterized picker (presets + an opacity submenu) — stays
        // hand-built, spliced between the registry blocks (the datasetRowMenu
        // "Move to …" precedent).
        {
          label: "Frame",
          submenu: [
            { label: "None", checked: !a?.frame, run: () => setFrame(id, undefined) },
            {
              label: "Subtle",
              checked: !!a?.frame && a.frame.fill === undefined,
              run: () => setFrame(id, { opacity: 0.15 }),
            },
            {
              label: "Solid",
              checked: !!a?.frame?.fill,
              // A canvas fillStyle needs a RESOLVED color, not a live
              // var(--x) reference — read the surface token NOW.
              run: () => setFrame(id, { fill: cssVar("--surface-2") || "#2a2a33", opacity: 1 }),
            },
            { separator: true },
            {
              label: "Opacity",
              disabled: !a?.frame,
              submenu: FRAME_OPACITY_STEPS.map((pct) => ({
                label: `${Math.round(pct * 100)}%`,
                checked: Math.abs(frameOpacity - pct) < 1e-6,
                run: () => setFrameOpacity(id, pct),
              })),
            },
          ],
        },
        ...buildMenuItems(annotationSizeActions, target),
        { separator: true },
        ...buildMenuItems([annotationDeleteAction], target),
      ],
    });
  };

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
      onEditText: editAnnotationText,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, hasAnnotations, selectedAnnotationId, setSelectedAnnotationId, updateAnnotation]);

  return { bridge, menu, closeMenu: () => setMenu(null) };
}
