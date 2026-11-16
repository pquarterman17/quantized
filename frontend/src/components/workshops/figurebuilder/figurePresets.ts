// Human-readable names for the publication style presets (UX audit 7, lane
// UX-H). The preset ids ("aps", "nature", ...) and their calibrated values
// live in src/quantized/calc/figure_styles.py and are NOT changed here: this
// module only maps an id to the label a lab scientist recognises ("APS ·
// single column · 8.6 × 6.5 cm"), with the size read from the frontend
// mirror in figureOutputConstants.ts. Pure: no React, no store.

import { FIGURE_STYLES, FIGURE_STYLE_SIZE_CM } from "./figureOutputConstants";

const NAMES: Record<string, string> = {
  default: "Default",
  aps: "APS · single column",
  aps_double: "APS · double column",
  nature: "Nature · single column",
  nature_double: "Nature · double column",
  thesis: "Thesis",
  report: "Report",
  web: "Web",
  presentation: "Slide",
  poster: "Poster",
};

/** The picker's order: journals first, grouped by publisher, then the
 *  general-purpose sizes. Every id here is a real backend preset; the two
 *  double-column ids are offered here although FIGURE_STYLES (shared with
 *  the map / batch / report pickers) does not list them. */
export const PRESET_ORDER: readonly string[] = [
  "default", "aps", "aps_double", "nature", "nature_double", "thesis", "report", "presentation", "poster", "web",
];

const trim = (n: number): string => String(Number(n.toFixed(1)));

/** "8.6 × 6.5 cm" for a size in cm. */
export function formatSizeCm(widthCm: number, heightCm: number): string {
  return `${trim(widthCm)} × ${trim(heightCm)} cm`;
}

/** "APS · single column · 8.6 × 6.5 cm"; an unknown id (a style saved by a
 *  newer build, say) shows as itself rather than disappearing. */
export function presetLabel(id: string): string {
  const name = NAMES[id];
  const size = FIGURE_STYLE_SIZE_CM[id];
  if (!name) return id;
  return size ? `${name} · ${formatSizeCm(size[0], size[1])}` : name;
}

/** The picker's options; `current` is kept even when it is not a known
 *  preset, so a document carrying one still shows its own value. */
export function presetOptions(current: string): { value: string; label: string }[] {
  const ids = [...PRESET_ORDER, ...FIGURE_STYLES.filter((id) => !PRESET_ORDER.includes(id))];
  if (current && !ids.includes(current)) ids.push(current);
  return ids.map((id) => ({ value: id, label: presetLabel(id) }));
}
