// The Publication Preview's drag-to-place commit map: which draft/override
// mutation a completed drag on a hitmapped element becomes. Extracted from
// useFigureBuilder.ts's `dragElement` when the F2.4e+F2.3f merge pushed the
// hook past its size pin -- the dispatch is pure logic over injected state,
// so it moves whole; the hook keeps only a thin closure-binding wrapper.
// (Behavior is exercised through the hook's own drag tests.)

import { refLineIdForHit } from "./canonicalRefLines";
import { shapeIdForHit, translateShape } from "./canonicalShapes";
import type { FigureOverrides } from "../../../lib/figureOverrides";
import { pxToCanvasFraction, pxToData, pxToFigureFraction, type FigureHitmap } from "../../../lib/previewmap";
import type { RefLine, Shape } from "../../../lib/types";

/** b minus a, both `{x, y}` points -> `[dx, dy]` — shared by the F2.4e shape
 *  branch across the data-anchor/page-anchor delta (same shape). */
const deltaXY = (a: { x: number; y: number }, b: { x: number; y: number }): [number, number] => [b.x - a.x, b.y - a.y];

/** The live state a drag commit reads and writes — bound by the hook. */
export interface PreviewDragDeps {
  hitmap: FigureHitmap | null;
  activeOverrides: FigureOverrides;
  setActiveOverrides: (next: FigureOverrides) => void;
  refLines: readonly RefLine[];
  setRefLineValue: (id: string, value: number) => void;
  shapes: readonly Shape[];
  setShapeStyle: (id: string, patch: Partial<Omit<Shape, "id">>) => void;
}

/** Drag-to-place: legend -> custom figure-fraction anchor; annotation ->
 *  new data coords. Both commit through the ONE overrides object (#11).
 *  `startPx`/`startPy` (the press origin, F2.4e) are optional so every
 *  pre-existing 3-arg call (legend/annotation drags, tests included) stays
 *  source-compatible — only the shape branch needs them. */
export function dragPreviewElement(
  deps: PreviewDragDeps,
  id: string,
  px: number,
  py: number,
  startPx?: number,
  startPy?: number,
): void {
  const { hitmap, activeOverrides, setActiveOverrides, refLines, setRefLineValue, shapes, setShapeStyle } = deps;
  if (!hitmap) return;
  if (id === "legend") {
    setActiveOverrides({
      ...activeOverrides,
      legend: {
        ...activeOverrides.legend,
        loc: "custom",
        anchor: pxToFigureFraction(hitmap.width, hitmap.height, px, py),
      },
    });
  } else if (id.startsWith("refline:")) {
    // F2.4d: drag a reference line to move it, the same gesture the Stage's
    // uPlot canvas already supports (`updateRefLine`). Value only — a line's
    // AXIS is fixed once created everywhere in the app, so a horizontal drag
    // of a Y line is a no-op rather than a reinterpretation.
    const lineId = refLineIdForHit(refLines, Number(id.slice("refline:".length)));
    const line = refLines.find((candidate) => candidate.id === lineId);
    if (!line) return;
    const { x, y } = pxToData(hitmap.axes, px, py);
    const next = line.axis === "x" ? x : y;
    if (Number.isFinite(next)) setRefLineValue(line.id, next);
  } else if (id.startsWith("ann:")) {
    const i = Number(id.slice(4));
    const anns = activeOverrides.annotations ?? [];
    if (!Number.isInteger(i) || i >= anns.length) return;
    const { x, y } = pxToData(hitmap.axes, px, py);
    setActiveOverrides({
      ...activeOverrides,
      annotations: anns.map((a, j) => (j === i ? { ...a, x, y } : a)),
    });
  } else if (id.startsWith("shape:")) {
    // F2.4e: translate by the pointer's DELTA, never jump to the drop point
    // (translateShape). Page anchor -> canvas-fraction delta
    // (pxToCanvasFraction); data anchor (default) -> data-coord delta, same
    // space a reference line's value already moves in.
    const shapeId = shapeIdForHit(shapes, Number(id.slice("shape:".length)));
    const shape = shapes.find((candidate) => candidate.id === shapeId);
    if (!shape || startPx === undefined || startPy === undefined) return;
    const [dx, dy] = shape.anchor === "page"
      ? deltaXY(pxToCanvasFraction(hitmap.width, hitmap.height, startPx, startPy), pxToCanvasFraction(hitmap.width, hitmap.height, px, py))
      : deltaXY(pxToData(hitmap.axes, startPx, startPy), pxToData(hitmap.axes, px, py));
    const patch = translateShape(shape, dx, dy);
    if (patch) setShapeStyle(shape.id, patch);
  }
}
