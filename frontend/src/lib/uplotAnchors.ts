// Anchor-point baseline gesture (GOTO #2): while the Baseline workshop's
// "Anchor points" method is live, a plain click on the plot places a baseline
// anchor at the clicked (x, y); a click ON an anchor removes it; dragging an
// anchor moves it. Structurally the 2-D sibling of peakMarkerHit's click
// gesture, plus refLinePlugin's capture-phase drag (a mousedown that hits a
// marker beats uPlot's own box-zoom drag; empty-canvas drags pass through so
// zoom/pan keep working). Live drag state is plugin-local (canvas redraw
// only) and commits ONCE on mouseup — the store bridge then refreshes the
// debounced baseline preview overlay. Markers are drawn here (diamonds);
// the interpolated baseline curve itself rides the shared baselineOverlay
// series, not this plugin.

import type uPlot from "uplot";

/** One placed anchor in DATA coords, tagged with its index into the
 *  workshop's anchor list (what onMove/onRemove expect). */
export interface AnchorPoint {
  index: number;
  x: number;
  y: number;
}

/** Anchor data coords → plot pixels via `valToPos` — separately testable with
 *  a minimal `{valToPos}` stub (the sibling plugins' `fakeU` idiom). */
export function anchorPixels(
  u: Pick<uPlot, "valToPos">,
  anchors: readonly AnchorPoint[],
): (AnchorPoint & { px: number; py: number })[] {
  return anchors.map((a) => ({
    ...a,
    px: u.valToPos(a.x, "x", true),
    py: u.valToPos(a.y, "y", true),
  }));
}

/** Which anchor (in PIXELS, from `anchorPixels`) the pointer is nearest to,
 *  within `tol` px (Euclidean — an anchor is a point, so the tolerance is a
 *  circle). Nearest wins; ties keep the earlier index. Null when nothing is
 *  within tolerance. */
export function hitTestAnchors(
  anchors: readonly { index: number; px: number; py: number }[],
  pointer: { x: number; y: number },
  tol = 8,
): number | null {
  let best: number | null = null;
  let bestDist = Infinity;
  for (const a of anchors) {
    if (!Number.isFinite(a.px) || !Number.isFinite(a.py)) continue;
    const d = Math.hypot(a.px - pointer.x, a.py - pointer.y);
    if (d <= tol && d < bestDist) {
      bestDist = d;
      best = a.index;
    }
  }
  return best;
}

/**
 * Workshop-scoped plot plugin (composes with whatever toolbar tool is active,
 * like peakMarkerEditPlugin / wheelZoomPlugin — the Baseline workshop's
 * anchor mode gates it via the store bridge, see PlotStage):
 *
 * - plain click (< 6 px movement) on empty canvas → `onAdd(x, y)` at the
 *   clicked DATA coords;
 * - plain click on an anchor marker → `onRemove(index)`;
 * - drag an anchor marker → live plugin-local redraw, `onMove(index, x, y)`
 *   committed once on release (capture-phase mousedown beats uPlot's
 *   box-zoom for that gesture only);
 * - drag on empty canvas → untouched (box zoom / pan proceed normally).
 */
export function anchorEditPlugin(
  anchors: readonly AnchorPoint[],
  opts: {
    onAdd: (x: number, y: number) => void;
    onMove: (index: number, x: number, y: number) => void;
    onRemove: (index: number) => void;
    color: string;
  },
  tol = 8,
): uPlot.Plugin {
  // Live override while dragging one anchor (null = not dragging).
  let drag: { index: number; x: number; y: number } | null = null;

  return {
    hooks: {
      ready: (u: uPlot) => {
        const over = u.over;
        over.style.cursor = "copy";

        over.addEventListener("mousemove", (e: MouseEvent) => {
          if (drag) return; // cursor fixed while a drag owns the pointer
          const rect = over.getBoundingClientRect();
          const pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
          const hit = hitTestAnchors(anchorPixels(u, anchors), pointer, tol);
          over.style.cursor = hit != null ? "pointer" : "copy";
        });

        over.addEventListener(
          "mousedown",
          (e: MouseEvent) => {
            if (e.button !== 0) return;
            const rect = over.getBoundingClientRect();
            const down = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            const hit = hitTestAnchors(anchorPixels(u, anchors), down, tol);

            if (hit == null) {
              // Empty canvas: don't block uPlot's own drag (zoom/pan). Commit
              // an add only if the release lands within the click threshold.
              const onUp = (ev: MouseEvent) => {
                document.removeEventListener("mouseup", onUp);
                const up = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
                if (Math.hypot(up.x - down.x, up.y - down.y) >= 6) return;
                opts.onAdd(u.posToVal(up.x, "x"), u.posToVal(up.y, "y"));
              };
              document.addEventListener("mouseup", onUp);
              return;
            }

            // On a marker: own the gesture (capture-phase beats uPlot's drag).
            e.preventDefault();
            e.stopPropagation();
            const a = anchors.find((p) => p.index === hit)!;
            drag = { index: hit, x: a.x, y: a.y };
            const onMove = (ev: MouseEvent) => {
              drag = {
                index: hit,
                x: u.posToVal(ev.clientX - rect.left, "x"),
                y: u.posToVal(ev.clientY - rect.top, "y"),
              };
              u.redraw();
            };
            const onUp = (ev: MouseEvent) => {
              document.removeEventListener("mousemove", onMove);
              document.removeEventListener("mouseup", onUp);
              const up = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
              drag = null;
              if (Math.hypot(up.x - down.x, up.y - down.y) < 6) {
                opts.onRemove(hit); // a click on the marker, not a drag
              } else {
                opts.onMove(hit, u.posToVal(up.x, "x"), u.posToVal(up.y, "y"));
              }
              u.redraw();
            };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
          },
          { capture: true },
        );
      },
      draw: (u: uPlot) => {
        if (anchors.length === 0 && !drag) return;
        const { ctx } = u;
        const { left, top, width, height } = u.bbox;
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();
        const r = 5;
        for (const a of anchors) {
          const live = drag && drag.index === a.index ? drag : a;
          const px = u.valToPos(live.x, "x", true);
          const py = u.valToPos(live.y, "y", true);
          if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
          ctx.beginPath();
          ctx.moveTo(px, py - r);
          ctx.lineTo(px + r, py);
          ctx.lineTo(px, py + r);
          ctx.lineTo(px - r, py);
          ctx.closePath();
          ctx.fillStyle = opts.color;
          ctx.globalAlpha = drag && drag.index === a.index ? 1 : 0.9;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.lineWidth = 1;
          ctx.strokeStyle = opts.color;
          ctx.stroke();
        }
        ctx.restore();
      },
    },
  };
}
