// One frame of the interactive 3-D view, in paint order. The plot -- back
// panes, marks, axes -- is CLIPPED to its own area (`Frame.plot`), so a zoomed
// box is cropped at that edge and never drawn under the colour bar or the title,
// which sit in their own column / strip outside it. The export crops the same
// way (`calc/figure_map3d.crop_3d`). Pure apart from drawing.

import { drawAxes, drawColorbar3d, drawPanes, drawTitle, type Frame, type Ink } from "./render3dAxes";
import { drawMarks, type DrawStats } from "./render3dMarks";
import type { Scene3d } from "./scene3d";

export function drawScene(
  ctx: CanvasRenderingContext2D, f: Frame, scene: Scene3d, ink: Ink & { mesh: string; drop: string }, fast: boolean, dpr: number,
): DrawStats {
  const p = f.plot;
  ctx.save();
  ctx.beginPath();
  ctx.rect(p.x, p.y, p.w, p.h);
  ctx.clip();
  drawPanes(ctx, f, scene, ink);
  const stats = drawMarks(ctx, f, scene, fast, dpr, ink);
  drawAxes(ctx, f, scene, ink);
  ctx.restore();
  drawTitle(ctx, f, scene, ink);
  drawColorbar3d(ctx, f, scene, ink);
  return stats;
}

/** Whether a pointer at (x, y) is over the plot (hover reads nothing elsewhere). */
export const inPlot = (f: Frame, x: number, y: number): boolean =>
  x >= f.plot.x && x <= f.plot.x + f.plot.w && y >= f.plot.y && y <= f.plot.y + f.plot.h;
