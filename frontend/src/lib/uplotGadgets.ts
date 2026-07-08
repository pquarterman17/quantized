// Quick-fit gadget (gap #33) plot plugin: drag an x-region on the live plot;
// once committed, the band grows move + edge-resize handles, mirroring the ∫
// / ∩ region tools' drag pattern (uplotRegionTools) generalized to a PERSISTENT,
// editable ROI rather than a one-shot commit. Live drag state is held
// plugin-locally in DATA coords (canvas redraw only); the committed ROI is fed
// back through `onRoiChange` on every meaningful change (create / move /
// resize), so the caller can debounce a live re-fit — see store `setQfitRoi`.
// A sub-6px drag on empty canvas is a click, not a region (no-op / clears).

import type uPlot from "uplot";

import { normalizeRange } from "./regionSelect";

export type RoiHandle = "left" | "right" | "move";

/** Which part of a committed [lo,hi] band (given in PIXELS) the pointer (also
 *  pixels) is over, within `tol` px — mirrors uplotOverlays.pickRefLine's
 *  tolerance-based hit-test. Edge checks win over "move" so a narrow band
 *  (edges closer than 2·tol) still exposes both resize handles; ties prefer
 *  the left edge. Null when the pointer is outside the band + tolerance. */
export function hitTestRoiHandles(
  loPx: number,
  hiPx: number,
  pointerPx: number,
  tol = 6,
): RoiHandle | null {
  if (Math.abs(pointerPx - loPx) <= tol) return "left";
  if (Math.abs(pointerPx - hiPx) <= tol) return "right";
  if (pointerPx > loPx && pointerPx < hiPx) return "move";
  return null;
}

/** Full-scan finite [min, max] of the plot's x data column, or null when
 *  nothing is finite — the bounds a create/move/resize drag clamps into
 *  (mirrors plotdata.clampPlottedRange's spirit, kept local to avoid a
 *  cross-module dependency for one small scan). */
function xDataExtent(u: uPlot): [number, number] | null {
  const xs = u.data[0] as (number | null)[];
  let min = Infinity;
  let max = -Infinity;
  for (const v of xs) {
    if (v == null || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return min <= max ? [min, max] : null;
}

/**
 * Quick-fit ROI band (drag-create, then move/resize a committed band). The
 * committed value is the `roi` PROP (source of truth after a rebuild); once
 * this instance itself commits a value via `onRoiChange`, that becomes the
 * instance-local source of truth for the REST of its life (so a rapid second
 * gesture — e.g. resizing right after creating — hit-tests against the
 * freshest value even before a React rebuild lands the new prop; the caller's
 * debounced re-fit means a rebuild doesn't necessarily land between gestures).
 */
export function quickFitPlugin(
  roi: [number, number] | null,
  color: string,
  fill: string,
  opts?: { onRoiChange?: (roi: [number, number] | null) => void; interactive?: boolean },
): uPlot.Plugin {
  // Instance-local override, once set (including to null = cleared), wins over
  // the `roi` prop for the rest of this plugin instance's life.
  let hasLocal = false;
  let local: [number, number] | null = null;
  const current = (): [number, number] | null => (hasLocal ? local : roi);
  const commit = (
    next: [number, number] | null,
    onRoiChange: (roi: [number, number] | null) => void,
  ): void => {
    hasLocal = true;
    local = next;
    onRoiChange(next);
  };

  return {
    hooks: {
      ready:
        opts?.interactive && opts.onRoiChange
          ? (u: uPlot) => {
              const over = u.over;
              const onRoiChange = opts.onRoiChange!;
              over.style.cursor = "crosshair";
              let dragging = false;

              over.addEventListener("mousemove", (e: MouseEvent) => {
                if (dragging) return; // cursor is fixed while a gesture owns it
                const c = current();
                if (!c) {
                  over.style.cursor = "crosshair";
                  return;
                }
                const rect = over.getBoundingClientRect();
                const pointerPx = e.clientX - rect.left;
                const loPx = u.valToPos(Math.min(c[0], c[1]), "x", true);
                const hiPx = u.valToPos(Math.max(c[0], c[1]), "x", true);
                const hit = hitTestRoiHandles(loPx, hiPx, pointerPx);
                over.style.cursor =
                  hit === "left" || hit === "right" ? "ew-resize" : hit === "move" ? "move" : "crosshair";
              });

              over.addEventListener("mousedown", (e: MouseEvent) => {
                if (e.button !== 0) return;
                e.preventDefault();
                const rect = over.getBoundingClientRect();
                const downPx = e.clientX - rect.left;
                const bounds = xDataExtent(u);
                const c = current();
                let hit: RoiHandle | null = null;
                if (c) {
                  const loPx = u.valToPos(Math.min(c[0], c[1]), "x", true);
                  const hiPx = u.valToPos(Math.max(c[0], c[1]), "x", true);
                  hit = hitTestRoiHandles(loPx, hiPx, downPx);
                }
                dragging = true;

                if (c && (hit === "left" || hit === "right")) {
                  const fixed = hit === "left" ? Math.max(c[0], c[1]) : Math.min(c[0], c[1]);
                  const onMove = (ev: MouseEvent) => {
                    const v = u.posToVal(ev.clientX - rect.left, "x");
                    commit(normalizeRange(fixed, v, bounds ? { min: bounds[0], max: bounds[1] } : undefined) ?? c, onRoiChange);
                    u.redraw();
                  };
                  const onUp = () => {
                    document.removeEventListener("mousemove", onMove);
                    document.removeEventListener("mouseup", onUp);
                    dragging = false;
                  };
                  document.addEventListener("mousemove", onMove);
                  document.addEventListener("mouseup", onUp);
                  return;
                }

                if (c && hit === "move") {
                  const lo0 = Math.min(c[0], c[1]);
                  const hi0 = Math.max(c[0], c[1]);
                  const width = hi0 - lo0;
                  const x0 = u.posToVal(downPx, "x");
                  const onMove = (ev: MouseEvent) => {
                    const x1 = u.posToVal(ev.clientX - rect.left, "x");
                    let newLo = lo0 + (x1 - x0);
                    let newHi = hi0 + (x1 - x0);
                    if (bounds) {
                      if (newLo < bounds[0]) {
                        newLo = bounds[0];
                        newHi = bounds[0] + width;
                      }
                      if (newHi > bounds[1]) {
                        newHi = bounds[1];
                        newLo = bounds[1] - width;
                      }
                    }
                    commit([newLo, newHi], onRoiChange);
                    u.redraw();
                  };
                  const onUp = () => {
                    document.removeEventListener("mousemove", onMove);
                    document.removeEventListener("mouseup", onUp);
                    dragging = false;
                  };
                  document.addEventListener("mousemove", onMove);
                  document.addEventListener("mouseup", onUp);
                  return;
                }

                // No hit (or nothing committed yet) → drag out a NEW roi.
                const x0 = u.posToVal(downPx, "x");
                commit([x0, x0], onRoiChange);
                u.redraw();
                const onMove = (ev: MouseEvent) => {
                  const x1 = u.posToVal(ev.clientX - rect.left, "x");
                  commit([Math.min(x0, x1), Math.max(x0, x1)], onRoiChange);
                  u.redraw();
                };
                const onUp = (ev: MouseEvent) => {
                  document.removeEventListener("mousemove", onMove);
                  document.removeEventListener("mouseup", onUp);
                  dragging = false;
                  const x1 = u.posToVal(ev.clientX - rect.left, "x");
                  const dpx = Math.abs(u.valToPos(x1, "x", true) - u.valToPos(x0, "x", true));
                  if (dpx < 6) {
                    commit(null, onRoiChange); // a click, not a region
                    u.redraw();
                    return;
                  }
                  commit(
                    normalizeRange(x0, x1, bounds ? { min: bounds[0], max: bounds[1] } : undefined),
                    onRoiChange,
                  );
                  u.redraw();
                };
                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup", onUp);
              });
            }
          : undefined,
      draw: (u: uPlot) => {
        const r = current();
        if (!r) return;
        const { ctx } = u;
        const { left, top, width, height } = u.bbox;
        const lo = Math.min(r[0], r[1]);
        const hi = Math.max(r[0], r[1]);
        const loPx = u.valToPos(lo, "x", true);
        const hiPx = u.valToPos(hi, "x", true);
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();
        const x = Math.max(left, loPx);
        const w = Math.min(left + width, hiPx) - x;
        if (w > 0) {
          ctx.fillStyle = fill;
          ctx.fillRect(x, top, w, height);
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        for (const px of [loPx, hiPx]) {
          if (px < left || px > left + width) continue;
          ctx.beginPath();
          ctx.moveTo(px, top);
          ctx.lineTo(px, top + height);
          ctx.stroke();
        }
        ctx.restore();
      },
    },
  };
}

export type CursorHandle = 0 | 1;

/** Which of two cursors (given in PIXELS) the pointer (also pixels) is over,
 *  within `tol` px — the two-point sibling of hitTestRoiHandles. Ties prefer
 *  cursor 0. Null when the pointer isn't near either. */
export function hitTestCursorHandles(
  aPx: number,
  bPx: number,
  pointerPx: number,
  tol = 6,
): CursorHandle | null {
  const dA = Math.abs(pointerPx - aPx);
  const dB = Math.abs(pointerPx - bPx);
  if (dA <= tol && dA <= dB) return 0;
  if (dB <= tol) return 1;
  return null;
}

/**
 * Paired-cursors gadget (gap #34): drag out two independent x-cursors (thin
 * lines, no fill — unlike quickFitPlugin's band) and move either one
 * afterwards. Structurally mirrors quickFitPlugin's create/move-edge drag
 * state machine (instance-local override once committed, sub-6px drag =
 * click = clear), but there is no "move both" gesture — a pointer-down
 * between the two cursors starts a NEW pair, matching quickFitPlugin's
 * fallback-to-create branch when nothing is hit.
 */
export function gadgetCursorsPlugin(
  cursors: [number, number] | null,
  color: string,
  opts?: { onCursorsChange?: (c: [number, number] | null) => void; interactive?: boolean },
): uPlot.Plugin {
  let hasLocal = false;
  let local: [number, number] | null = null;
  const current = (): [number, number] | null => (hasLocal ? local : cursors);
  const commit = (
    next: [number, number] | null,
    onCursorsChange: (c: [number, number] | null) => void,
  ): void => {
    hasLocal = true;
    local = next;
    onCursorsChange(next);
  };

  return {
    hooks: {
      ready:
        opts?.interactive && opts.onCursorsChange
          ? (u: uPlot) => {
              const over = u.over;
              const onCursorsChange = opts.onCursorsChange!;
              over.style.cursor = "crosshair";
              let dragging = false;

              over.addEventListener("mousemove", (e: MouseEvent) => {
                if (dragging) return;
                const c = current();
                if (!c) {
                  over.style.cursor = "crosshair";
                  return;
                }
                const rect = over.getBoundingClientRect();
                const pointerPx = e.clientX - rect.left;
                const aPx = u.valToPos(c[0], "x", true);
                const bPx = u.valToPos(c[1], "x", true);
                over.style.cursor = hitTestCursorHandles(aPx, bPx, pointerPx) != null ? "ew-resize" : "crosshair";
              });

              over.addEventListener("mousedown", (e: MouseEvent) => {
                if (e.button !== 0) return;
                e.preventDefault();
                const rect = over.getBoundingClientRect();
                const downPx = e.clientX - rect.left;
                const bounds = xDataExtent(u);
                const c = current();
                let hit: CursorHandle | null = null;
                if (c) {
                  const aPx = u.valToPos(c[0], "x", true);
                  const bPx = u.valToPos(c[1], "x", true);
                  hit = hitTestCursorHandles(aPx, bPx, downPx);
                }
                dragging = true;

                if (c && hit != null) {
                  const other = hit === 0 ? c[1] : c[0];
                  const onMove = (ev: MouseEvent) => {
                    let v = u.posToVal(ev.clientX - rect.left, "x");
                    if (bounds) v = Math.min(bounds[1], Math.max(bounds[0], v));
                    commit(hit === 0 ? [v, other] : [other, v], onCursorsChange);
                    u.redraw();
                  };
                  const onUp = () => {
                    document.removeEventListener("mousemove", onMove);
                    document.removeEventListener("mouseup", onUp);
                    dragging = false;
                  };
                  document.addEventListener("mousemove", onMove);
                  document.addEventListener("mouseup", onUp);
                  return;
                }

                // No hit (or nothing placed yet) → drag out a NEW cursor pair.
                const x0 = u.posToVal(downPx, "x");
                commit([x0, x0], onCursorsChange);
                u.redraw();
                const onMove = (ev: MouseEvent) => {
                  const x1 = u.posToVal(ev.clientX - rect.left, "x");
                  commit([x0, x1], onCursorsChange);
                  u.redraw();
                };
                const onUp = (ev: MouseEvent) => {
                  document.removeEventListener("mousemove", onMove);
                  document.removeEventListener("mouseup", onUp);
                  dragging = false;
                  const x1 = u.posToVal(ev.clientX - rect.left, "x");
                  const dpx = Math.abs(u.valToPos(x1, "x", true) - u.valToPos(x0, "x", true));
                  if (dpx < 6) {
                    commit(null, onCursorsChange); // a click, not a placement
                    u.redraw();
                    return;
                  }
                  commit([x0, x1], onCursorsChange);
                  u.redraw();
                };
                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup", onUp);
              });
            }
          : undefined,
      draw: (u: uPlot) => {
        const c = current();
        if (!c) return;
        const { ctx } = u;
        const { left, top, width, height } = u.bbox;
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([2, 3]);
        for (const v of c) {
          const px = u.valToPos(v, "x", true);
          if (px < left || px > left + width) continue;
          ctx.beginPath();
          ctx.moveTo(px, top);
          ctx.lineTo(px, top + height);
          ctx.stroke();
        }
        ctx.restore();
      },
    },
  };
}
