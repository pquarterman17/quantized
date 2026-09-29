// The spatial multi-panel FIT mode: the type, its cycle order and the cycle
// step. Split out of lib/panelLayout.ts (bundle diet slice 12,
// plans/BUNDLE_HEADROOM.md) because the plot-view model (lib/plotview.ts)
// and store (store/plotViewSettings.ts) need these on first paint while the
// pixel geometry in panelLayout.ts is reached only by lazy stages and
// exporters. Moved verbatim; panelLayout.ts re-exports all three.

/** How a spatial multi-panel composition fills the interactive stage
 *  (ORIGIN_FILE_DECODE_PLAN #54):
 *   - `"frames"` — letterbox the decoded frames' bounding box, preserving its
 *     aspect (PR #47's default; the compatibility behaviour when the field is
 *     absent from an older `.dwk`).
 *   - `"window"` — ignore aspect, stretch the frames to fill the whole host
 *     (the wide-multi-panel "poor fill" remedy for e.g. RockingCurve Graph3).
 *   - `"page"` — letterbox the FULL Origin page (aspect from the window's
 *     `pageSetup`) and place each frame at its true page coordinates within it
 *     (Stage 2 — needs `pageRect`/`pageSetup`; falls back to `"frames"` when
 *     that geometry isn't available). */
export type PanelFit = "frames" | "window" | "page";

/** The fit modes in cycle order. `page` is only offered when the window has a
 *  decoded/edited page (see `nextPanelFit`'s `allowPage`). */
export const PANEL_FITS: readonly PanelFit[] = ["frames", "window", "page"];

/** The next fit mode in the toolbar/command cycle. `page` is skipped unless
 *  `allowPage` (no `pageSetup` -> a two-way frames<->window toggle). Pure so
 *  the store action and its test share one source of truth. */
export function nextPanelFit(current: PanelFit, allowPage: boolean): PanelFit {
  const cycle: readonly PanelFit[] = allowPage ? PANEL_FITS : ["frames", "window"];
  const i = cycle.indexOf(current);
  return cycle[(i + 1) % cycle.length];
}
