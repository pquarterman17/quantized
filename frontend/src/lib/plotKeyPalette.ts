// Colours for a box drawn ON the plot canvas (the overlay key). The box sits
// on the PLOT's background, which a window can pin light or dark independently
// of the app theme, so the app-theme tokens (`--text`) and the theme-invariant
// `--axes-bg-light` must not be mixed: that gave pale text on a light-grey box
// in the dark scheme. Both colours come from the same plot background instead.

import type uPlot from "uplot";

import { resolvePlotBg } from "./uplotOpts";

export interface KeyPalette {
  /** Box fill: the plot's own background. */
  bg: string;
  /** Text and rule ink, readable on `bg`. */
  ink: string;
}

const TRANSPARENT = /^(transparent|rgba?\([^)]*[,/ ]\s*0(\.0+)?\s*\))$/i;

/** The first opaque background behind the plot, or "" when none is set (tests, detached roots). */
function domBackground(u: uPlot): string {
  let el: HTMLElement | null = (u as { root?: HTMLElement }).root ?? null;
  for (let hop = 0; el && hop < 8; hop++, el = el.parentElement) {
    const bg = getComputedStyle(el).backgroundColor;
    if (bg && !TRANSPARENT.test(bg.trim())) return bg;
  }
  return "";
}

export function keyPalette(u: uPlot): KeyPalette {
  const tokens = resolvePlotBg();
  const axis = (u as { axes?: { stroke?: unknown }[] }).axes?.[0]?.stroke;
  return { bg: domBackground(u) || tokens.axesBg, ink: typeof axis === "string" && axis ? axis : tokens.inkColor };
}
