// Pointer-mode annotation direct manipulation (MAIN #18) — wires the canvas
// plugin's bridge (lib/uplotOverlays' interactive annotationPlugin) to the
// store + the app's existing dialog convention (`askParams`, the same path
// PlotContextMenu's "Rename series…"/"Set axis limits…" already use — there
// is no dedicated Inspector text-edit today, so this reuses the established
// prompt pattern rather than inventing a second one). Extracted out of
// PlotStage to keep that component under its line ceiling — the same
// reasoning as useGadgetChip/useAxisDrop/usePlotStageActions.

import { useEffect, useMemo, useState } from "react";

import { clampAnnotationSize, MAX_ANNOTATION_SIZE, MIN_ANNOTATION_SIZE } from "../../lib/uplotOverlays";
import type { BuildOptsArgs } from "../../lib/uplotOpts";
import { useApp } from "../../store/useApp";
import type { ContextMenuItem } from "../overlays/ContextMenu";
import { askParams } from "../overlays/ParamDialog";

/** The corner-handle drag's step size for the object menu's Size +/− entries
 *  (a discrete click, unlike the drag's continuous px-to-size mapping). */
const MENU_SIZE_STEP = 2;
/** The base annotation font size (uplotOpts' default tick px) — used only as
 *  the STARTING point for a "Size +/-" click on an annotation that has no
 *  explicit `size` yet. */
const DEFAULT_ANNOTATION_SIZE = 12;

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
  const removeAnnotation = useApp((s) => s.removeAnnotation);
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

  const editText = (id: string) => {
    const a = useApp.getState().annotations.find((x) => x.id === id);
    void askParams("Edit annotation text", [
      { key: "text", label: "Text", type: "text", default: a?.text ?? "" },
    ]).then((v) => {
      if (v) updateAnnotation(id, { text: String(v.text) });
    });
  };

  const bumpSize = (id: string, delta: number) => {
    const a = useApp.getState().annotations.find((x) => x.id === id);
    updateAnnotation(id, { size: clampAnnotationSize((a?.size ?? DEFAULT_ANNOTATION_SIZE) + delta) });
  };

  const openMenu = (id: string, clientX: number, clientY: number) => {
    const a = useApp.getState().annotations.find((x) => x.id === id);
    const size = a?.size ?? DEFAULT_ANNOTATION_SIZE;
    setMenu({
      x: clientX,
      y: clientY,
      items: [
        { header: a?.text || "Annotation" },
        { label: "Edit text…", run: () => editText(id) },
        { label: "Size +", run: () => bumpSize(id, MENU_SIZE_STEP), disabled: size >= MAX_ANNOTATION_SIZE },
        { label: "Size −", run: () => bumpSize(id, -MENU_SIZE_STEP), disabled: size <= MIN_ANNOTATION_SIZE },
        { separator: true },
        {
          label: "Delete",
          danger: true,
          run: () => {
            removeAnnotation(id);
            setSelectedAnnotationId(null);
          },
        },
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
      onEditText: editText,
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
