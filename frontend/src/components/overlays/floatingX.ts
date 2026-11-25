// Default x of a FLOATING analysis tool window `width` px wide: just left of
// the side column (the Inspector, or the window docked there once this one
// floats), clear of the plot's Y axis and the Library. It used to place the
// window against `window.innerWidth`, i.e. over the Inspector (audit 7
// finding 4). Shared by Curve Fit and the Peak analyzer; while a window is
// docked itself its x is unused (store/toolDock.ts).

import { dockColumnPx, dockWidthWithout, libraryWidth } from "../../store/toolDock";

const GAP = 16;

/** The Inspector's live width: the --rw the Inspector pref / resize grip
 *  writes inline on <html> (a cheap read, no style pass); the spacing.css
 *  token is the pre-boot fallback. */
function inspectorWidth(): number {
  const v = parseFloat(document.documentElement.style.getPropertyValue("--rw"));
  return Number.isFinite(v) && v > 0 ? v : 296;
}

/** The side column's width once window `self` floats. */
function sideColumnWidth(self: string | undefined): number {
  const docked = dockWidthWithout(self);
  if (docked !== null) return dockColumnPx(docked, window.innerWidth, libraryWidth());
  return document.querySelector(".qzk-main")?.classList.contains("rc") ? 0 : inspectorWidth();
}

/** Left edge of the main plot's body (uPlot's `.u-over`), i.e. the right edge
 *  of its Y-axis gutter (tick labels and the x10^n multiplier); 0 when no plot
 *  is mounted. */
function plotBodyLeft(): number {
  const over = document.querySelector(".qzk-stage .u-over");
  return over ? Math.max(0, Math.round(over.getBoundingClientRect().left)) : 0;
}

/** Pure placement: against the right edge of the stage (`room` px of viewport
 *  left of the side column), but never left of the plot body when the window
 *  fits there -- a window too wide for the plot overhangs the side column
 *  instead of covering the Y-axis labels. */
export function placeFloatingX(viewport: number, side: number, width: number, bodyLeft: number): number {
  const edge = Math.max(GAP, Math.round(viewport - side - width - GAP));
  return Math.max(edge, Math.min(bodyLeft, viewport - width - GAP));
}

export function floatingX(width: number, self?: string): number {
  if (typeof window === "undefined" || typeof document === "undefined") return 120;
  return placeFloatingX(window.innerWidth, sideColumnWidth(self), width, plotBodyLeft());
}
