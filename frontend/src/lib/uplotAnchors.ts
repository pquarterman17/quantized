// Anchor-point baseline gesture (GOTO #2): while the Baseline workshop's
// "Anchor points" method is live, a plain click on the plot places a baseline
// anchor at the clicked (x, y); a click ON an anchor removes it; dragging an
// anchor moves it. Rides the shared point-gesture core (lib/pointGesture) for
// pixel-frame conversion + hit testing, plus refLinePlugin's capture-phase
// drag (a mousedown that hits a marker beats uPlot's own box-zoom drag;
// empty-canvas drags pass through so zoom/pan keep working). Live drag state
// is plugin-local (canvas redraw only) and commits ONCE on mouseup — the
// store bridge then refreshes the debounced baseline preview overlay.
// Markers are drawn here (diamonds); the interpolated baseline curve itself
// rides the shared baselineOverlay series, not this plugin.
//
// MAIN #8f: the plugin reads the anchor list through a GETTER, not a captured
// snapshot — the bridge object stays identity-stable across anchor edits, so
// PlotViewport's rebuild effect (keyed on the bridge) no longer tears the
// uPlot instance down twice per gesture (once for the bridge, once for the
// debounced preview). The plugin self-redraws after each commit instead.

import type uPlot from "uplot";

import { CLICK_PX, hitTestPoints, pointPixels, type GesturePoint } from "./pointGesture";

/** One placed anchor in DATA coords, tagged with its index into the
 *  workshop's anchor list (what onMove/onRemove expect) — the shared
 *  gesture-point shape. */
export type AnchorPoint = GesturePoint;

/**
 * Workshop-scoped plot plugin (composes with whatever toolbar tool is active,
 * like peakMarkerEditPlugin / wheelZoomPlugin — the Baseline workshop's
 * anchor mode gates it via the store bridge, see PlotStage):
 *
 * - plain click (< CLICK_PX movement) on empty canvas → `onAdd(x, y)` at the
 *   clicked DATA coords;
 * - plain click on an anchor marker → `onRemove(index)`;
 * - drag an anchor marker → live plugin-local redraw, `onMove(index, x, y)`
 *   committed once on release (capture-phase mousedown beats uPlot's
 *   box-zoom for that gesture only);
 * - drag on empty canvas → untouched (box zoom / pan proceed normally).
 *
 * `getAnchors` must return the CURRENT list on every call (a ref read, not a
 * snapshot) — see the module header for why.
 */
export function anchorEditPlugin(
  getAnchors: () => readonly AnchorPoint[],
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
  let destroyed = false;

  // MAIN #8f: anchor pixels recompute only when the anchor list identity or
  // the scale window / plot size changes — not on every pointer move (the
  // cursor handler previously ran valToPos over the whole list per event).
  let cache: {
    anchors: readonly AnchorPoint[];
    key: string;
    pixels: (GesturePoint & { px: number; py: number })[];
  } | null = null;
  const pixels = (u: uPlot) => {
    const anchors = getAnchors();
    const { x, y } = u.scales;
    const key = `${x.min},${x.max},${y.min},${y.max},${u.over.clientWidth},${u.over.clientHeight}`;
    if (!cache || cache.anchors !== anchors || cache.key !== key) {
      cache = { anchors, key, pixels: pointPixels(u, anchors) };
    }
    return cache.pixels;
  };

  // A commit mutates React state; the owner's re-render refreshes what
  // `getAnchors()` returns AFTER the current event flushes, so redraw on the
  // next animation frame (the draw hook reads the getter fresh) instead of
  // synchronously repainting the stale list.
  const redrawSoon = (u: uPlot) =>
    requestAnimationFrame(() => {
      if (!destroyed) u.redraw();
    });

  return {
    hooks: {
      destroy: () => {
        destroyed = true;
      },
      ready: (u: uPlot) => {
        const over = u.over;
        over.style.cursor = "copy";

        over.addEventListener("mousemove", (e: MouseEvent) => {
          if (drag) return; // cursor fixed while a drag owns the pointer
          const rect = over.getBoundingClientRect();
          const pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
          const hit = hitTestPoints(pixels(u), pointer, tol);
          over.style.cursor = hit != null ? "pointer" : "copy";
        });

        over.addEventListener(
          "mousedown",
          (e: MouseEvent) => {
            if (e.button !== 0) return;
            const rect = over.getBoundingClientRect();
            const down = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            const hit = hitTestPoints(pixels(u), down, tol);

            if (hit == null) {
              // Empty canvas: don't block uPlot's own drag (zoom/pan). Commit
              // an add only if the release lands within the click threshold.
              const onUp = (ev: MouseEvent) => {
                document.removeEventListener("mouseup", onUp);
                const up = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
                if (Math.hypot(up.x - down.x, up.y - down.y) >= CLICK_PX) return;
                opts.onAdd(u.posToVal(up.x, "x"), u.posToVal(up.y, "y"));
                redrawSoon(u);
              };
              document.addEventListener("mouseup", onUp);
              return;
            }

            // On a marker: own the gesture (capture-phase beats uPlot's drag).
            e.preventDefault();
            e.stopPropagation();
            const a = getAnchors().find((p) => p.index === hit)!;
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
              if (Math.hypot(up.x - down.x, up.y - down.y) < CLICK_PX) {
                opts.onRemove(hit); // a click on the marker, not a drag
              } else {
                opts.onMove(hit, u.posToVal(up.x, "x"), u.posToVal(up.y, "y"));
              }
              u.redraw(); // clear the plugin-local drag override now …
              redrawSoon(u); // … and repaint the committed list post-flush
            };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
          },
          { capture: true },
        );
      },
      draw: (u: uPlot) => {
        const anchors = getAnchors();
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
