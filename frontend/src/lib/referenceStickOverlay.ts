// Canvas painter for one XRD reference stick. Kept separate from the already
// pinned uplotOverlays coordinator so this scientific overlay does not grow
// that general-purpose module past its shrink-only architecture ceiling.

import type { RefLine } from "./types";

export function drawReferenceStick(
  ctx: CanvasRenderingContext2D,
  line: RefLine,
  x: number,
  plotTop: number,
  plotHeight: number,
): boolean {
  const stick = line.stick;
  if (!stick?.visible) return false;
  const baseline = plotTop + plotHeight * (1 - stick.baseline);
  const tip = baseline - plotHeight * stick.height * stick.intensity;
  ctx.strokeStyle = ctx.fillStyle = stick.color;
  ctx.setLineDash([]);
  ctx.moveTo(x, baseline);
  ctx.lineTo(x, tip);
  if (line.label && stick.showLabel) {
    ctx.save(); ctx.translate(x + 3, tip - 3); ctx.rotate(-Math.PI / 2);
    ctx.fillText(line.label, 0, 0); ctx.restore();
  }
  return true;
}
