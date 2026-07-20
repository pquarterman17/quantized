import type { Annotation, Shape } from "./types";

export type PlotObjectKey = `annotation:${string}` | `shape:${string}`;
export type LayoutCommand =
  | "left"
  | "hcenter"
  | "right"
  | "top"
  | "vcenter"
  | "bottom"
  | "distribute-h"
  | "distribute-v";

export interface PlotObjectPatches {
  annotations: Record<string, Partial<Omit<Annotation, "id">>>;
  shapes: Record<string, Partial<Omit<Shape, "id">>>;
  error?: string;
}

interface Item {
  type: "annotation" | "shape";
  id: string;
  anchor: "data" | "page";
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export const annotationKey = (id: string): PlotObjectKey => `annotation:${id}`;
export const shapeKey = (id: string): PlotObjectKey => `shape:${id}`;

function selectedItems(
  annotations: readonly Annotation[],
  shapes: readonly Shape[],
  selected: ReadonlySet<PlotObjectKey>,
): Item[] {
  return [
    ...annotations
      .filter((a) => selected.has(annotationKey(a.id)))
      .map((a): Item => ({
        type: "annotation",
        id: a.id,
        anchor: a.anchor ?? "data",
        left: a.x,
        right: a.x,
        top: a.y,
        bottom: a.y,
      })),
    ...shapes
      .filter((s) => selected.has(shapeKey(s.id)))
      .map((s): Item => ({
        type: "shape",
        id: s.id,
        anchor: s.anchor ?? "data",
        left: Math.min(s.x1, s.x2),
        right: Math.max(s.x1, s.x2),
        top: Math.min(s.y1, s.y2),
        bottom: Math.max(s.y1, s.y2),
      })),
  ];
}

function translate(
  item: Item,
  dx: number,
  dy: number,
  annotations: readonly Annotation[],
  shapes: readonly Shape[],
  out: PlotObjectPatches,
): void {
  // Page-anchored coordinates are [0,1] canvas fractions, and EVERY other
  // write path enforces that range (clampPageXY, canvasPxToPageXY,
  // sanitizeShapes/sanitizeAnnotations). The edge commands are safe by
  // construction — they target one of the selection's own valid edges — but
  // hcenter/vcenter/distribute align by object CENTRES and ignore each
  // object's extent, so a mixed-width selection could push a wide object's
  // far edge past 1: off-canvas now, and silently re-clamped on the next
  // .dwk round-trip (a second, unexplained jump). Clamp the DELTA rather
  // than the endpoints so the object slides back into range at its original
  // size instead of being squashed.
  if (item.anchor === "page") {
    dx = Math.min(Math.max(dx, -item.left), 1 - item.right);
    dy = Math.min(Math.max(dy, -item.top), 1 - item.bottom);
  }
  if (item.type === "annotation") {
    const a = annotations.find((candidate) => candidate.id === item.id)!;
    out.annotations[item.id] = { x: a.x + dx, y: a.y + dy };
  } else {
    const s = shapes.find((candidate) => candidate.id === item.id)!;
    out.shapes[item.id] = { x1: s.x1 + dx, x2: s.x2 + dx, y1: s.y1 + dy, y2: s.y2 + dy };
  }
}

/** Compute alignment/distribution without touching the store. Mixed page/data
 * coordinate selections fail closed because their numeric coordinates are not
 * comparable. */
export function layoutPlotObjects(
  annotations: readonly Annotation[],
  shapes: readonly Shape[],
  selected: ReadonlySet<PlotObjectKey>,
  command: LayoutCommand,
): PlotObjectPatches {
  const out: PlotObjectPatches = { annotations: {}, shapes: {} };
  const items = selectedItems(annotations, shapes, selected);
  if (items.length < 2) return { ...out, error: "Select at least two objects" };
  if (new Set(items.map((item) => item.anchor)).size !== 1) {
    return { ...out, error: "Page- and data-anchored objects cannot be aligned together" };
  }

  const centersX = items.map((item) => (item.left + item.right) / 2);
  const centersY = items.map((item) => (item.top + item.bottom) / 2);
  if (command.startsWith("distribute") && items.length < 3) {
    return { ...out, error: "Select at least three objects to distribute" };
  }

  if (command === "distribute-h" || command === "distribute-v") {
    const horizontal = command === "distribute-h";
    const sorted = [...items].sort((a, b) => {
      const ac = horizontal ? (a.left + a.right) / 2 : (a.top + a.bottom) / 2;
      const bc = horizontal ? (b.left + b.right) / 2 : (b.top + b.bottom) / 2;
      return ac - bc;
    });
    const first = horizontal
      ? (sorted[0].left + sorted[0].right) / 2
      : (sorted[0].top + sorted[0].bottom) / 2;
    const lastItem = sorted[sorted.length - 1];
    const last = horizontal
      ? (lastItem.left + lastItem.right) / 2
      : (lastItem.top + lastItem.bottom) / 2;
    const step = (last - first) / (sorted.length - 1);
    sorted.forEach((item, index) => {
      const current = horizontal
        ? (item.left + item.right) / 2
        : (item.top + item.bottom) / 2;
      const delta = first + step * index - current;
      translate(item, horizontal ? delta : 0, horizontal ? 0 : delta, annotations, shapes, out);
    });
    return out;
  }

  const target = command === "left"
    ? Math.min(...items.map((item) => item.left))
    : command === "right"
      ? Math.max(...items.map((item) => item.right))
      : command === "top"
        ? Math.min(...items.map((item) => item.top))
        : command === "bottom"
          ? Math.max(...items.map((item) => item.bottom))
          : command === "hcenter"
            ? centersX.reduce((sum, value) => sum + value, 0) / centersX.length
            : centersY.reduce((sum, value) => sum + value, 0) / centersY.length;

  for (const item of items) {
    const current = command === "left"
      ? item.left
      : command === "right"
        ? item.right
        : command === "top"
          ? item.top
          : command === "bottom"
            ? item.bottom
            : command === "hcenter"
              ? (item.left + item.right) / 2
              : (item.top + item.bottom) / 2;
    const delta = target - current;
    translate(
      item,
      command === "left" || command === "right" || command === "hcenter" ? delta : 0,
      command === "top" || command === "bottom" || command === "vcenter" ? delta : 0,
      annotations,
      shapes,
      out,
    );
  }
  return out;
}

