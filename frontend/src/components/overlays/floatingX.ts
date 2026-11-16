// Default x of a FLOATING analysis tool window `width` px wide: just left of
// the side column (the Inspector, or the window docked there once this one
// floats), clear of the plot's Y axis and the Library. It used to place the
// window against `window.innerWidth`, i.e. over the Inspector (audit 7
// finding 4). Shared by Curve Fit and the Peak analyzer; while a window is
// docked itself its x is unused (store/toolDock.ts).

import { DOCK_MIN_WIDTH, DOCK_STAGE_MIN, dockWidthWithout } from "../../store/toolDock";

const GAP = 16;
// styles/spacing.css --rw / --lw fallbacks, read once: they are fixed tokens
// (the Library's --lw changes only by a drag, and only bounds a clamp here).
let tokens: { rw: number; lw: number } | null = null;
function sideTokens(): { rw: number; lw: number } {
  if (!tokens) {
    const css = getComputedStyle(document.documentElement);
    const px = (name: string, dflt: number) => {
      const v = parseFloat(css.getPropertyValue(name));
      return Number.isFinite(v) && v > 0 ? v : dflt;
    };
    tokens = { rw: px("--rw", 296), lw: px("--lw", 210) };
  }
  return tokens;
}

/** The side column's width once window `self` floats. */
function sideColumnWidth(self: string | undefined): number {
  const { rw, lw } = sideTokens();
  const docked = dockWidthWithout(self);
  // Same clamp as dockColumnWidth (store/toolDock.ts), in px.
  if (docked !== null) return Math.min(docked, Math.max(DOCK_MIN_WIDTH, window.innerWidth - lw - DOCK_STAGE_MIN));
  return document.querySelector(".qzk-main")?.classList.contains("rc") ? 0 : rw;
}

export function floatingX(width: number, self?: string): number {
  if (typeof window === "undefined" || typeof document === "undefined") return 120;
  return Math.max(GAP, Math.round(window.innerWidth - sideColumnWidth(self) - width - GAP));
}
