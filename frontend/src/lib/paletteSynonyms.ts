// The ⌘K palette's small synonym table: what a scientist TYPES, mapped to the
// words the command is actually NAMED with. Keys and values are lower-case
// single words (keys) and phrases (values); a phrase matches a command when
// every one of its words is a word (or word prefix) of the command's label,
// or of its keywords.
//
// Kept apart from `paletteRank.ts` so adding a synonym is a one-line data
// change, and so the ranker's tests can assert the table without the logic.
// Quantized-side only: `lib/fuzzy.ts` stays the shared fermiviewer matcher.

export const PALETTE_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  // Fitting and analysis
  fit: ["curve fit"],
  fitting: ["curve fit"],
  regression: ["curve fit"],
  peak: ["find peaks"],
  peaks: ["find peaks"],
  background: ["baseline"],
  bg: ["baseline"],
  // Signal processing
  derivative: ["derivative"],
  differentiate: ["derivative"],
  diff: ["derivative"],
  gradient: ["derivative"],
  slope: ["derivative"],
  integrate: ["integrate"],
  integral: ["integrate"],
  area: ["integrate"],
  smooth: ["smooth"],
  smoothing: ["smooth"],
  denoise: ["smooth"],
  noise: ["smooth"],
  savgol: ["smooth"],
  normalise: ["normalize"],
  normalization: ["normalize"],
  spectrum: ["fft"],
  fourier: ["fft"],
  // Figures and export
  pdf: ["export pdf", "export figure"],
  svg: ["export svg", "export figure"],
  png: ["export figure"],
  eps: ["export figure"],
  tiff: ["export figure"],
  vector: ["export figure"],
  // Axes and error bars
  errorbar: ["error bars"],
  errorbars: ["error bars"],
  error: ["error bars"],
  uncertainty: ["error bars"],
  sigma: ["error bars"],
  logarithmic: ["log"],
  // Daily-job vocabulary (UX audit 8 #6)
  save: ["save workspace"],
  linear: ["curve fit"],
  gaussian: ["curve fit", "find peaks"],
  lorentzian: ["curve fit", "find peaks"],
  batch: ["curve fit", "find peaks"],
  position: ["find peaks"],
  tc: ["find peaks"],
  convert: ["calculators"],
  conversion: ["calculators"],
  tesla: ["calculators"],
  oe: ["calculators"],
  aps: ["export figure"],
  nature: ["export figure"],
  journal: ["export figure"],
  preset: ["export figure"],
  presets: ["export figure"],
  font: ["publication preview"],
  fonts: ["publication preview"],
  size: ["publication preview"],
  annotate: ["text box", "arrow"],
  annotation: ["text box", "arrow"],
  // Data in
  open: ["import"],
  load: ["import"],
  csv: ["import"],
};

/** The synonym phrases for a typed word, exact first; a prefix of at least
 *  three characters also reaches a key ("deriv" -> derivative), so a
 *  half-typed word is helped as well as a whole one. */
export function synonymPhrases(term: string): string[] {
  const exact = PALETTE_SYNONYMS[term];
  if (exact) return [...exact];
  if (term.length < 3) return [];
  const out: string[] = [];
  for (const [key, phrases] of Object.entries(PALETTE_SYNONYMS)) {
    if (key.startsWith(term)) out.push(...phrases);
  }
  return out;
}

/** Words that NAME one command outright: typing the key puts these command ids
 *  first, ahead of commands that merely contain the word in a longer label
 *  ("dark" is the theme toggle, not "Window Background (Theme / Light /
 *  Dark)"; "settings" is Preferences, not "Y Axis Settings…"). Keys are the
 *  whole normalised query (words joined by a space); ids are action ids.
 *  Provisional, owner to confirm: the mapping is a UX judgement, one line each.
 *  A key that names a command absent from the palette changes nothing. */
export const PALETTE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  settings: ["preferences"],
  setting: ["preferences"],
  options: ["preferences"],
  config: ["preferences"],
  configuration: ["preferences"],
  dark: ["theme-dark"],
  light: ["theme-light"],
  "dark mode": ["theme-dark"],
  "light mode": ["theme-light"],
  "night mode": ["theme-dark"],
  theme: ["theme"],
  close: ["window-close"],
};

/** The action ids a typed query names outright (see {@link PALETTE_ALIASES}). */
export function aliasIds(terms: readonly string[]): readonly string[] {
  return PALETTE_ALIASES[terms.join(" ")] ?? [];
}
