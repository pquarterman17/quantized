// The export half of the Preferences ▸ Plot "Font size" (lib/plotStylePrefs).
// Kept out of the eager modules; only the export request builder imports it.

import { PLOT_TEMPLATES } from "./plotTemplates";

/** The export `font_size` (pt) a non-default screen font size rides as, else
 *  undefined (the style preset's own size, today's behaviour). The canvas'
 *  12 px corresponds to the default style's 10 pt (calc/figure_styles.py), so
 *  the pref scales by 10/12; other templates carry no font on the wire. */
export function screenFontPt(template: string | undefined): number | undefined {
  const px = PLOT_TEMPLATES[0].fontSize; // the Screen template, kept in step by lib/plotStylePrefsSlot
  return (template ?? "screen") === "screen" && px !== 12 ? (px * 5) / 6 : undefined;
}
