// Pure per-shape canonical-draft helpers (F2.3c): derive a display row per
// drawn shape (kind glyph + kind-scoped label, e.g. "arrow 1", "arrow 2",
// "rect 1" -- matches `Inspector/ShapesCard.tsx`'s `KIND_GLYPH` convention)
// and patch/remove one shape by id in the draft's `shapes` array. No
// React/store import -- unit-testable standalone, same shape as
// canonicalSeries.ts.
//
// `shapes` is a `PlotView` field (`decor.shapes`, see lib/figureContract.ts)
// with NO `FigureOverrides` equivalent -- exactly the F2.3b situation for
// seriesStyles/hiddenChannels/seriesOrder -- so the hook writes it straight
// through `setCanonicalView`, not the publication-overrides delta bridge.

import type { Shape } from "../../../lib/types";

export const SHAPE_KIND_GLYPH: Record<Shape["kind"], string> = {
  arrow: "↗", // matches Inspector/ShapesCard.tsx's KIND_GLYPH exactly
  line: "╱",
  rect: "▭",
  ellipse: "◯",
};

export interface ShapeRow {
  id: string;
  kind: Shape["kind"];
  /** Kind-scoped, 1-based display label (e.g. "arrow 1", "arrow 2", "rect 1")
   *  -- more informative than a flat draw-order index once a draft mixes
   *  kinds, and stable under reorder since it only depends on each shape's
   *  own kind and position among same-kind siblings. */
  label: string;
}

/** One row per shape, in the draft's own array order (shapes have no
 *  separate `seriesOrder`-style display-order field -- see Shape's doc). */
export function deriveShapeRows(shapes: readonly Shape[]): ShapeRow[] {
  const seen = new Map<Shape["kind"], number>();
  return shapes.map((shape) => {
    const n = (seen.get(shape.kind) ?? 0) + 1;
    seen.set(shape.kind, n);
    return { id: shape.id, kind: shape.kind, label: `${shape.kind} ${n}` };
  });
}

/** Only rect/ellipse read a `fill` -- arrow/line ignore it (see
 *  `lib/uplotShapes.ts`'s `resolveShapeFill`/`defaultShapeOpacity` docs and
 *  `Stage/useShapeEdit.ts`'s `canFill`, which this mirrors verbatim). */
export function shapeSupportsFill(kind: Shape["kind"]): boolean {
  return kind === "rect" || kind === "ellipse";
}

/** Merge `patch` into the one shape matching `id`; every other shape is
 *  returned unchanged (by reference). A no-op array (same length, same
 *  entries) for an unknown id -- callers don't special-case a missing shape. */
export function patchShapeList(
  shapes: readonly Shape[],
  id: string,
  patch: Partial<Omit<Shape, "id">>,
): Shape[] {
  return shapes.map((shape) => (shape.id === id ? { ...shape, ...patch } : shape));
}

/** Drop the one shape matching `id`. No-op (same-length array) for an
 *  unknown id. */
export function removeShapeFromList(shapes: readonly Shape[], id: string): Shape[] {
  return shapes.filter((shape) => shape.id !== id);
}
