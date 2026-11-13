// The canvas arrowhead for a drawn arrow shape (MAIN #27) — split out of
// `lib/uplotShapes.ts` (shrink-only size pin) when the head gained its own
// colour (publication-figures audit #11).

/** Draw one arrowhead (a small filled triangle) at (x2,y2), oriented along
 *  the p1->p2 direction. `size` is the CSS-px length along the shaft. The
 *  head is solid `color` (the arrow's STROKE), like the export's
 *  FancyArrowPatch `-|>` head: an arrow's own fill is "transparent" (fill
 *  applies to rect/ellipse only), and filling the head with that fill drew
 *  no arrowhead on screen at all while the export showed one. */
export function drawArrowhead(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  size: number,
  color: string,
): void {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const spread = Math.PI / 7;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - size * Math.cos(angle - spread), y2 - size * Math.sin(angle - spread));
  ctx.lineTo(x2 - size * Math.cos(angle + spread), y2 - size * Math.sin(angle + spread));
  ctx.closePath();
  ctx.fill();
}
