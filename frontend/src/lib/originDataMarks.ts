// Floating-column rectangles and vector arrows an Origin figure carries at
// DATA coordinates (`figure.data_marks`, `io/origin_project/opju_float_vector`)
// become plot shapes: the screen draw and the matplotlib export already
// paint shapes, so no new renderer ships. Only reached from the lazy apply
// body (`store/originApplyRun`).
import type { OriginFigure, Shape } from "./types";

/** Id prefix of the shapes an apply creates; a later apply replaces exactly these. */
export const FIGURE_MARK_PREFIX = "figmark-";

/** The plot's shapes after applying `fig`: the user's own shapes kept, any
 *  earlier figure's marks swapped for this figure's (a figure with none
 *  clears them). A mark with a non-finite end is skipped, never guessed. */
export function originDataMarkShapes(current: Shape[], fig: OriginFigure, key: string): Shape[] {
  const kept = current.filter((s) => !s.id.startsWith(FIGURE_MARK_PREFIX));
  const marks: Shape[] = [];
  (fig.data_marks ?? []).forEach((m, i) => {
    if (![m.x1, m.y1, m.x2, m.y2].every(Number.isFinite)) return;
    marks.push({
      id: `${FIGURE_MARK_PREFIX}${key}-${i}`,
      kind: m.kind,
      x1: m.x1,
      y1: m.y1,
      x2: m.x2,
      y2: m.y2,
      anchor: "data",
      ...(m.stroke ? { stroke: m.stroke } : {}),
      ...(m.width !== undefined ? { width: m.width } : {}),
    });
  });
  return [...kept, ...marks];
}

/** The store patch for applying `fig`: `{}` (no `shapes` key at all) when it
 *  has no marks and none are left over from an earlier figure. */
export function originDataMarkPatch(current: Shape[], fig: OriginFigure, key: string): { shapes?: Shape[] } {
  const stale = current.some((s) => s.id.startsWith(FIGURE_MARK_PREFIX));
  return fig.data_marks?.length || stale ? { shapes: originDataMarkShapes(current, fig, key) } : {};
}
