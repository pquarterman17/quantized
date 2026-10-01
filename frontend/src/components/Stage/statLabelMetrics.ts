// The Stat Stage's category-axis TEXT METRICS (P2.6 box 1 leftover): one
// measurer for the axis layout, the painter and the hit-test, so a measured
// label depth or a wrap-or-rotate decision is the same number in all three.
// In a browser it is the canvas's own `measureText` (an offscreen 2D context
// set to the tick font every painter draws with); where no context exists,
// the JetBrains Mono 10 px estimate. The unit-test setup pins the estimate
// (`setLabelMeasurer`) because node-canvas would otherwise measure whatever
// monospace font the machine resolves — a count-based number is what the
// layout tests can pin; `statRenderAxes.fit.test.ts` injects its own.

export const CHAR_W = 6; // JetBrains Mono 10px advance, px
export const LABEL_FONT = "10px 'JetBrains Mono', monospace";

/** The width a label gets when nothing can measure it: one advance per code point. */
export function monospaceEstimate(text: string): number {
  return Array.from(text).length * CHAR_W;
}

let override: ((text: string) => number) | null = null;
let measureCtx: CanvasRenderingContext2D | null | undefined; // undefined = not yet tried

/** Replace the measurer (null restores the canvas / estimate path). */
export function setLabelMeasurer(measure: ((text: string) => number) | null): void {
  override = measure;
}

/** A tick label's width, px (see the module header). */
export function labelWidth(text: string): number {
  if (override) return override(text);
  if (measureCtx === undefined) {
    measureCtx = typeof document === "undefined" ? null : (document.createElement("canvas").getContext("2d") ?? null);
  }
  if (!measureCtx) return monospaceEstimate(text);
  measureCtx.font = LABEL_FONT;
  return measureCtx.measureText(text).width;
}
