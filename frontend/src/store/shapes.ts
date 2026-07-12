// The shapes slice (MAIN #27 — drawing shapes on plots): owns BOTH the
// `shapes` array itself (a `PlotView` field — see `lib/plotview.ts`, swapped
// per-window by the focused-window facade exactly like `annotations`) and
// the transient draw/select tool state, composed into the ONE useApp store
// instance the same way `./pointerTool` is (read that file's header first —
// same "kept tiny so it doesn't grow useApp.ts past its store-size ratchet
// pin" reasoning; useApp.ts is near its OWN pin, so this feature's state
// lives here instead of inline in useApp.ts's big field list). Unlike
// pointerTool.ts (which only adds the annotation EDIT actions — the
// `annotations` array itself lives directly on useApp.ts), this slice owns
// the whole `shapes` array + its actions, since there was no pre-existing
// home for it.
//
// `drawShapeKind`/`selectedShapeId` are transient tool state (like
// `selectedAnnotationId`) — NOT PlotView fields, NOT undo-recorded, NOT
// reset on window/dataset focus switch (ids are drawn from the module-local
// `_shapeSeq`, never reused, so a stale id simply matches nothing).

import type { Shape } from "../lib/types";
import type { AppState } from "./useApp";

let _shapeSeq = 0;

export interface ShapesSlice {
  /** Drawn shapes (MAIN #27). A `PlotView` field — swapped per-window,
   *  persists via `.dwk` (see `lib/plotview.ts`'s `sanitizeShapes`). */
  shapes: Shape[];
  /** Non-null while the shape-drawing MODE is active (dock flyout / Insert
   *  menu pick): the plot shows a crosshair + status hint, and a drag on
   *  the canvas creates a shape of this kind. `"textbox"` is not a `Shape`
   *  kind — it's handled by `useShapeDraw`, which creates an ANNOTATION
   *  with a default frame instead (MAIN #27's "one text system" decision).
   *  Cleared automatically once a shape/text-box is placed (auto-return to
   *  the pointer tool) or on Escape. */
  drawShapeKind: Shape["kind"] | "textbox" | null;
  setDrawShapeKind: (kind: Shape["kind"] | "textbox" | null) => void;
  /** The shape selected in pointer mode (click-select / drag-move /
   *  handle-reshape target); null = nothing selected. Transient, not
   *  window-scoped — see the module doc above. */
  selectedShapeId: string | null;
  setSelectedShapeId: (id: string | null) => void;
  /** Add a new shape (drag-to-draw commit); returns its id so a caller
   *  (e.g. immediately opening the object menu) can reference it. */
  addShape: (shape: Omit<Shape, "id">) => string;
  /** Commit a shape edit (drag-move, handle-drag reshape, right-click style
   *  change, pin to page/data) ONCE — the refLine/annotation "plugin-local
   *  live preview, store commits on release" pattern. No-op for an unknown
   *  id. */
  updateShape: (id: string, patch: Partial<Omit<Shape, "id">>) => void;
  removeShape: (id: string) => void;
  /** Inspector "Shapes" card bulk action. */
  clearShapes: () => void;
}

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;

export function createShapesSlice(set: SliceSet): ShapesSlice {
  return {
    shapes: [],
    drawShapeKind: null,
    setDrawShapeKind: (drawShapeKind) => set({ drawShapeKind }),
    selectedShapeId: null,
    setSelectedShapeId: (selectedShapeId) => set({ selectedShapeId }),
    addShape: (shape) => {
      const id = `shape-${++_shapeSeq}`;
      set((s) => ({ shapes: [...s.shapes, { ...shape, id }] }));
      return id;
    },
    updateShape: (id, patch) =>
      set((s) => ({ shapes: s.shapes.map((sh) => (sh.id === id ? { ...sh, ...patch } : sh)) })),
    removeShape: (id) => set((s) => ({ shapes: s.shapes.filter((sh) => sh.id !== id) })),
    clearShapes: () => set({ shapes: [], selectedShapeId: null }),
  };
}
