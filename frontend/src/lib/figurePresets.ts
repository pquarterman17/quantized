// Human-readable names for the publication style presets (UX audit 7, lane
// UX-H), shared by every preset picker: the export view, the quick Export
// dialog, Batch figures, Multi-panel export, Send to report and the map's
// 3-D view. The preset ids ("aps", "nature", ...) and their calibrated values
// live in src/quantized/calc/figure_styles.py and are NOT changed here: this
// module maps an id to the label a lab scientist recognises ("APS · single
// column · 8.6 × 6.5 cm"). Pure data, no React, no store.

/** Each preset's own figure size in cm (width, height), mirrored by hand from
 *  calc/figure_styles.py (fig_width_cm / fig_height_cm) — the frontend test
 *  `figurePresets.test.ts` parses that file so the two cannot drift. Display
 *  only: labels, the preview's ruler/readout and render resolution read it;
 *  the backend applies the real values. A Page setup size overrides it. */
export const FIGURE_STYLE_SIZE_CM: Record<string, readonly [number, number]> = {
  default: [15.24, 10.16],
  aps: [8.6, 6.5],
  aps_double: [17.8, 6.5],
  nature: [8.9, 6.0],
  nature_double: [18.3, 6.0],
  thesis: [15.0, 10.0],
  report: [12.0, 8.5],
  web: [16.0, 10.0],
  presentation: [25.0, 18.0],
  poster: [30.0, 22.0],
};

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

/** Every backend preset, journals first (grouped by publisher), then the
 *  general-purpose sizes. Includes the two double-column presets the older
 *  pickers' FIGURE_STYLES list never offered. */
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

/** Labels for `ids`, keyed by id — for a ParamDialog select's `optionLabels`. */
export function presetLabels(ids: readonly string[] = PRESET_ORDER): Record<string, string> {
  return Object.fromEntries(ids.map((id) => [id, presetLabel(id)]));
}

/** A picker's options over `ids` (default: every preset); `current` is kept
 *  even when it is not listed, so a document carrying one still shows its
 *  own value. */
export function presetOptions(current: string, ids: readonly string[] = PRESET_ORDER): { value: string; label: string }[] {
  const all = current && !ids.includes(current) ? [...ids, current] : [...ids];
  return all.map((id) => ({ value: id, label: presetLabel(id) }));
}
