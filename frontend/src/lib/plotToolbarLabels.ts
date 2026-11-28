// "Toolbar button labels" (Preferences ▸ Plot, owner decision OG18): a short
// text caption beside each plot-toolbar icon. Loaded lazily with the tool plugins (lib/uplotToolPlugins.ts) and
// only once the preference is on, so the captions, and the code that draws
// them, add nothing to the eager bundle. (A stylesheet cannot do this part
// lazily without a preload entry in the entry chunk, and the CSP forbids
// injecting a <style>; CSSOM property writes are allowed.)
//
// The captions are keyed by each def's `id` in plotToolbarDefs.ts and apply to
// the buttons by their accessible name (the def's `name`), so the tooltip,
// the aria-label and the caption all start from the one def. A def with no
// entry here shows its `name`. Every caption is a word or two of its name, so
// the visible text is contained in the accessible name (pinned by the tests).
// The caption span is aria-hidden and the button keeps its aria-label, so the
// name is never read twice.

import {
  ANALYZE_TOOLS,
  COPY_DATA,
  COPY_FIGURE,
  INSET_MODE,
  INSPECT_TOOLS,
  NAVIGATE_TOOLS,
  POLAR_MODE,
  RESET_VIEW,
  SAVE_PNG,
  SMART_SCALE,
  SNAPSHOT_WINDOW,
  STACK_MODE,
  STAT_MODE,
} from "./plotToolbarDefs";
import { applyToolbarCaptions } from "./toolbarCaptionDom";

export const SHORT_LABELS: Readonly<Record<string, string>> = {
  cursor: "Cursor",
  stats: "Stats",
  select: "Select",
  lasso: "Lasso",
  pick: "Pick",
  fwhm: "FWHM",
  qfit: "Fit",
  reset: "Reset",
  smartScale: "Auto-scale",
  stack: "Stack",
  inset: "Inset",
  polar: "Polar",
  statMode: "Statistics",
  snapshotWindow: "Snapshot",
};

/** The caption of each labelled button, by accessible name. */
export function captionsByName(): Map<string, string> {
  const defs = [
    ...NAVIGATE_TOOLS,
    ...INSPECT_TOOLS,
    ...ANALYZE_TOOLS,
    RESET_VIEW,
    SMART_SCALE,
    STACK_MODE,
    INSET_MODE,
    POLAR_MODE,
    STAT_MODE,
    SAVE_PNG,
    COPY_DATA,
    COPY_FIGURE,
    SNAPSHOT_WINDOW,
  ];
  return new Map(defs.map((d) => [d.name, SHORT_LABELS[d.id] ?? d.name]));
}

/** Put the captions on (`on`) or take them off the buttons of `bar`. Idempotent.
 *  Returns whether they are now showing. */
export function syncToolbarLabels(bar: HTMLElement | null, on: boolean): boolean {
  const names = captionsByName();
  return applyToolbarCaptions(bar, on, (b) => names.get(b.getAttribute("aria-label") ?? "") ?? (b.dataset.tip === "Draw Shape" ? "Draw" : undefined));
}
