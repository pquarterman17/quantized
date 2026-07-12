// Drag-to-draw a new shape / place a text box (MAIN #27) — wires the store's
// `drawShapeKind` mode to `lib/uplotShapes`' `shapesPlugin` draw bridge.
// Extracted out of PlotStage the same way `useAnnotationEdit` is (keep
// PlotStage under its line ceiling).
//
// "Text box" is NOT a `Shape` kind (MAIN #27's "one text system" decision —
// it rides the annotation's own anchor/size/drag, just with a frame): the
// plugin still captures the CLICK on this same gesture path (so it doesn't
// fall through to whatever tool is active), but this hook is what actually
// creates an ANNOTATION with a default frame at that point AND immediately
// opens the text dialog — discoverability: you asked for a text box, you
// get a cursor ready to type.

import { useEffect, useMemo } from "react";

import type { BuildOptsArgs } from "../../lib/uplotOpts";
import type { Shape } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { askAnnotationText } from "../overlays/AnnotationTextDialog";

export type DrawShapeKind = Shape["kind"] | "textbox";

/** The status-line hint for each drawing mode (the house's transient-hint
 *  convention — see PlotToolbar's tool tooltips for the sibling pattern). */
const DRAW_HINTS: Record<DrawShapeKind, string> = {
  arrow: "drag to draw an arrow — Esc cancels",
  line: "drag to draw a line — Esc cancels",
  rect: "drag to draw a rectangle — Esc cancels",
  ellipse: "drag to draw an ellipse — Esc cancels",
  textbox: "click to place a text box — Esc cancels",
};

/** A fresh text box's default frame — a faint solid-ish backing so it reads
 *  as "a box", not a bare label, the instant it lands (MAIN #27's flyout
 *  discoverability requirement). */
const DEFAULT_TEXTBOX_FRAME = { opacity: 0.9 };

export interface ShapeDrawResult {
  /** Pass straight through to <PlotViewport shapeDraw={...}>; null when no
   *  drawing mode is active. */
  shapeDraw: NonNullable<BuildOptsArgs["shapeDraw"]> | null;
}

export function useShapeDraw(): ShapeDrawResult {
  const drawShapeKind = useApp((s) => s.drawShapeKind);
  const setDrawShapeKind = useApp((s) => s.setDrawShapeKind);
  const addShape = useApp((s) => s.addShape);
  const addAnnotation = useApp((s) => s.addAnnotation);
  const updateAnnotation = useApp((s) => s.updateAnnotation);
  const setSelectedShapeId = useApp((s) => s.setSelectedShapeId);
  const setSelectedAnnotationId = useApp((s) => s.setSelectedAnnotationId);
  const setPlotTool = useApp((s) => s.setPlotTool);

  // Status-line hint while a mode is active; Escape cancels it (mirrors
  // useAnnotationEdit's Escape-deselect pattern — only listens while a mode
  // IS active).
  useEffect(() => {
    if (!drawShapeKind) return;
    useApp.getState().setStatus(DRAW_HINTS[drawShapeKind]);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawShapeKind(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawShapeKind, setDrawShapeKind]);

  const shapeDraw = useMemo<NonNullable<BuildOptsArgs["shapeDraw"]> | null>(() => {
    if (!drawShapeKind) return null;
    return {
      drawKind: drawShapeKind,
      // Auto-return to pointer (MAIN #27 spec): clears the mode AND flips
      // the toolbar tool to "pointer" so the just-placed object is
      // immediately selected + directly manipulable (select/drag/resize),
      // not left stranded under whatever tool was active before drawing.
      onDrawCommit: (kind, x1, y1, x2, y2) => {
        setDrawShapeKind(null);
        setPlotTool("pointer");
        if (kind === "textbox") {
          const id = addAnnotation(x1, y1, "");
          updateAnnotation(id, { frame: DEFAULT_TEXTBOX_FRAME });
          setSelectedAnnotationId(id);
          void askAnnotationText("Text box", "").then((v) => {
            if (v != null) updateAnnotation(id, { text: v });
          });
          return;
        }
        const id = addShape({ kind, x1, y1, x2, y2 });
        setSelectedShapeId(id);
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    drawShapeKind,
    addShape,
    addAnnotation,
    updateAnnotation,
    setSelectedShapeId,
    setSelectedAnnotationId,
    setPlotTool,
    setDrawShapeKind,
  ]);

  return { shapeDraw };
}
