// GUI_INTERACTION #8 residual: the annotation & shape OBJECT menus' fixed
// actions as context-action registry entries (lib/contextActions), so the
// right-click object menus (useAnnotationEdit / useShapeEdit), the ⌘K
// palette (lib/paletteContextActions) and the selection mini-toolbar
// (SelectionMiniToolbar) all run the SAME definitions. The parameterized
// pickers (Frame presets, stroke/fill swatches, opacity/width steps) stay
// hand-built in the hooks — pickers don't fit the registry's {id,label,run}
// shape (the same call made for plotMenu's colour/marker pickers when the
// registry first landed).
//
// The `conv` field on both targets is the canvas plugin's precomputed
// anchor conversion (data↔page coordinates for the pin toggle). Only a live
// right-click on the canvas can supply it — the plugin owns the uPlot
// instance the conversion needs. Palette / mini-toolbar callers pass
// `conv: null` and the pin toggle hides itself there.

import { clampAnnotationSize, MAX_ANNOTATION_SIZE, MIN_ANNOTATION_SIZE } from "../../lib/uplotOverlays";
import type { ShapeAnchorConversion } from "../../lib/uplotShapes";
import type { ContextAction } from "../../lib/contextActions";
import { useApp } from "../../store/useApp";
import { askAnnotationText } from "../overlays/AnnotationTextDialog";

/** The corner-handle drag's step size for the object menu's Size +/− entries
 *  (a discrete click, unlike the drag's continuous px-to-size mapping). */
export const MENU_SIZE_STEP = 2;
/** The base annotation font size (uplotOpts' default tick px) — used only as
 *  the STARTING point for a "Size +/-" click on an annotation that has no
 *  explicit `size` yet. */
export const DEFAULT_ANNOTATION_SIZE = 12;

// ── annotation registry ─────────────────────────────────────────────────

export interface AnnotationConv {
  toPage: { x: number; y: number };
  toData: { x: number; y: number };
}

export interface AnnotationActionTarget {
  id: string;
  conv: AnnotationConv | null;
}

const getAnnotation = (id: string) => useApp.getState().annotations.find((x) => x.id === id);

/** MAIN #25: RichLabelInput-backed text editor (Ω palette, `$...$` syntax).
 *  Exported so `useAnnotationEdit`'s canvas bridge (double-click a label)
 *  keeps calling the same editor the registry entry runs. */
export function editAnnotationText(id: string): void {
  const a = getAnnotation(id);
  void askAnnotationText("Edit annotation text", a?.text ?? "").then((v) => {
    if (v != null) useApp.getState().updateAnnotation(id, { text: v });
  });
}

function bumpAnnotationSize(id: string, delta: number): void {
  const a = getAnnotation(id);
  useApp
    .getState()
    .updateAnnotation(id, { size: clampAnnotationSize((a?.size ?? DEFAULT_ANNOTATION_SIZE) + delta) });
}

export const annotationEditActions: ContextAction<AnnotationActionTarget>[] = [
  { id: "annotation.editText", label: "Edit text…", run: (t) => editAnnotationText(t.id) },
  // MAIN #21: flip between "data" (moves with zoom/pan) and "page"
  // (canvas-fraction, resize-stable) anchoring, converting x/y IN PLACE from
  // the plugin's precomputed `conv` so the label doesn't jump on the toggle.
  {
    id: "annotation.pinToggle",
    label: (t) =>
      getAnnotation(t.id)?.anchor === "page" ? "Pin to data (follows zoom)" : "Pin to page (stays on zoom)",
    checked: (t) => getAnnotation(t.id)?.anchor === "page",
    hidden: (t) => t.conv == null,
    run: (t) => {
      const a = getAnnotation(t.id);
      const conv = t.conv;
      if (!a || !conv) return;
      if (a.anchor === "page") {
        useApp.getState().updateAnnotation(t.id, { anchor: "data", x: conv.toData.x, y: conv.toData.y });
      } else {
        useApp.getState().updateAnnotation(t.id, { anchor: "page", x: conv.toPage.x, y: conv.toPage.y });
      }
    },
  },
];

export const annotationSizeActions: ContextAction<AnnotationActionTarget>[] = [
  {
    id: "annotation.sizeUp",
    label: "Size +",
    enabled: (t) => (getAnnotation(t.id)?.size ?? DEFAULT_ANNOTATION_SIZE) < MAX_ANNOTATION_SIZE,
    run: (t) => bumpAnnotationSize(t.id, MENU_SIZE_STEP),
  },
  {
    id: "annotation.sizeDown",
    label: "Size −",
    enabled: (t) => (getAnnotation(t.id)?.size ?? DEFAULT_ANNOTATION_SIZE) > MIN_ANNOTATION_SIZE,
    run: (t) => bumpAnnotationSize(t.id, -MENU_SIZE_STEP),
  },
];

export const annotationDeleteAction: ContextAction<AnnotationActionTarget> = {
  id: "annotation.delete",
  label: "Delete",
  danger: true, // red, but NO confirm — cheap to recreate (see ContextAction.danger)
  run: (t) => {
    const s = useApp.getState();
    s.removeAnnotation(t.id);
    s.setSelectedAnnotationId(null);
  },
};

/** Every annotation action, flat — palette / mini-toolbar consumers. */
export const annotationActions: ContextAction<AnnotationActionTarget>[] = [
  ...annotationEditActions,
  ...annotationSizeActions,
  annotationDeleteAction,
];

// ── shape registry ──────────────────────────────────────────────────────

export interface ShapeConv {
  toPage: ShapeAnchorConversion;
  toData: ShapeAnchorConversion;
}

export interface ShapeActionTarget {
  id: string;
  conv: ShapeConv | null;
}

const getShape = (id: string) => useApp.getState().shapes.find((x) => x.id === id);

export const shapeToggleActions: ContextAction<ShapeActionTarget>[] = [
  {
    id: "shape.dashed",
    label: "Dashed",
    checked: (t) => !!getShape(t.id)?.dash,
    run: (t) => useApp.getState().updateShape(t.id, { dash: !getShape(t.id)?.dash }),
  },
  // MAIN #27: same data↔page anchor flip as the annotation entry, converting
  // BOTH endpoints in place.
  {
    id: "shape.pinToggle",
    label: (t) =>
      getShape(t.id)?.anchor === "page" ? "Pin to data (follows zoom)" : "Pin to page (stays on zoom)",
    checked: (t) => getShape(t.id)?.anchor === "page",
    hidden: (t) => t.conv == null,
    run: (t) => {
      const s = getShape(t.id);
      const conv = t.conv;
      if (!s || !conv) return;
      if (s.anchor === "page") {
        useApp.getState().updateShape(t.id, { anchor: "data", ...conv.toData });
      } else {
        useApp.getState().updateShape(t.id, { anchor: "page", ...conv.toPage });
      }
    },
  },
];

export const shapeDeleteAction: ContextAction<ShapeActionTarget> = {
  id: "shape.delete",
  label: "Delete",
  danger: true,
  run: (t) => {
    const s = useApp.getState();
    s.removeShape(t.id);
    s.setSelectedShapeId(null);
  },
};

/** Every shape action, flat — palette / mini-toolbar consumers. */
export const shapeActions: ContextAction<ShapeActionTarget>[] = [...shapeToggleActions, shapeDeleteAction];
