// "Toolbar button labels" (Preferences ▸ Plot, OG18) for the Map toolbar. Only the glyph-only buttons are
// captioned, keyed by their accessible name; a button that already shows a word or a symbol with letters
// ("log", "Q", "2θ/ω", "3D", "Σx") has no entry and is left exactly as it is. Every caption is a word of its
// button's name, so the visible text is contained in the accessible name (pinned by the tests). The module
// rides the Map stage chunk (its only importer is the Map toolbar's hook), so it adds nothing eagerly.

import { applyToolbarCaptions } from "./toolbarCaptionDom";

/** The caption of each captioned Map-toolbar button, by its aria-label. */
export const MAP_CAPTIONS: Readonly<Record<string, string>> = {
  Contours: "Contours",
  "Integration box": "Box",
  "Polygon ROI": "Polygon",
  "Pick point": "Pick",
  "H-cut": "H-cut",
  "V-cut": "V-cut",
  "Segment cut": "Segment",
  "Angled cut": "Angled",
  "Sector wedge": "Wedge",
  "Map operations": "Operations",
  "Export map": "Export",
};

/** Put the Map toolbar's captions on (`on`) or take them off `dock`. Idempotent. */
export function syncMapToolbarLabels(dock: HTMLElement | null, on: boolean): boolean {
  return applyToolbarCaptions(dock, on, (b) => MAP_CAPTIONS[b.getAttribute("aria-label") ?? ""]);
}
