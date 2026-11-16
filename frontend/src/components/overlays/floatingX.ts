// Default x of a FLOATING analysis tool window `width` px wide: just left of
// the side column (the Inspector, or the window docked there once this one
// floats), clear of the plot's Y axis and the Library. It used to place the
// window against `window.innerWidth`, i.e. over the Inspector (audit 7
// finding 4). Shared by Curve Fit and the Peak analyzer; while a window is
// docked itself its x is unused (store/toolDock.ts).

import { dockColumnPx, dockWidthWithout } from "../../store/toolDock";

const GAP = 16;

// The Inspector's width, styles/spacing.css --rw: a fixed token, read once.
let rwCache: number | null = null;
function inspectorWidth(): number {
  if (rwCache === null) {
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--rw"));
    rwCache = Number.isFinite(v) && v > 0 ? v : 296;
  }
  return rwCache;
}

/** The Library's live width: 0 while collapsed, else the --lw the Library
 *  pref / resize grip writes inline on <html> (a cheap read, no style pass). */
export function libraryWidth(): number {
  if (document.querySelector(".qzk-main")?.classList.contains("lc")) return 0;
  const v = parseFloat(document.documentElement.style.getPropertyValue("--lw"));
  return Number.isFinite(v) && v > 0 ? v : 210;
}

/** The side column's width once window `self` floats. */
function sideColumnWidth(self: string | undefined): number {
  const docked = dockWidthWithout(self);
  if (docked !== null) return dockColumnPx(docked, window.innerWidth, libraryWidth());
  return document.querySelector(".qzk-main")?.classList.contains("rc") ? 0 : inspectorWidth();
}

export function floatingX(width: number, self?: string): number {
  if (typeof window === "undefined" || typeof document === "undefined") return 120;
  return Math.max(GAP, Math.round(window.innerWidth - sideColumnWidth(self) - width - GAP));
}
