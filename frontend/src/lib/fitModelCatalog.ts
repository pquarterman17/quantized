// Curve Fit's model list, grouped the way Origin's Fitting Function Organizer
// groups it (re-audit #14). The backend registry (calc/fit_models*.py) holds
// Quantized's own models next to Origin's built-ins under their Origin names,
// and a flat 72-entry list read as near-duplicates: "Exponential Decay" /
// "ExpDec1" / "ExpDecay1", "Gaussian" / "Gauss", "Poly5" next to "Poly 6".
//
// Nothing is renamed or removed: a saved fit, recipe or project names a model
// by its registry name, which stays the option's value. Only what the picker
// SHOWS changes:
//   - each model sits under its Origin category (Quantized's own physics
//     models under their own headings, after Origin's);
//   - a Quantized model that draws EXACTLY the same curve as an Origin
//     built-in says so ("= ExpDec1"), and one that is a special case says
//     how ("GaussAmp with y0 = 0"); a differing form says what differs;
//   - Origin's "Poly5" is shown as "Poly 5", matching "Poly 6" … "Poly 8".
// Every alias below was checked against the model functions' formulas.

import type { FitModel } from "./types";

/** Registry category -> the picker's group heading (Origin's names first). */
const GROUP_OF: Record<string, string> = {
  Linear: "Polynomial",
  Polynomial: "Polynomial",
  Exponential: "Exponential",
  Decay: "Exponential",
  Growth: "Exponential",
  "Growth/Sigmoidal": "Growth/Sigmoidal",
  Sigmoid: "Growth/Sigmoidal",
  "Peak Functions": "Peak Functions",
  Peak: "Peak Functions",
  Power: "Power",
  Waveform: "Waveform",
  Magnetic: "Magnetism",
  Hysteresis: "Magnetic hysteresis",
  Thermal: "Thermal",
  Other: "Other",
};

/** Group order: Origin's categories, then Quantized's own, then anything new. */
const GROUP_ORDER = [
  "Polynomial",
  "Exponential",
  "Growth/Sigmoidal",
  "Peak Functions",
  "Power",
  "Waveform",
  "Magnetism",
  "Magnetic hysteresis",
  "Thermal",
  "Other",
];

/** What the picker shows for a registry name, when it is not the name itself. */
const DISPLAY: Record<string, string> = {
  // The Origin name leads; the older Quantized name it replaces in the list
  // is said once, after it (see ALIAS_OF).
  ExpDec1: "ExpDec1 (= Exponential Decay)",
  ExpGro1: "ExpGro1 (= Exponential Growth)",
  ExpDec2: "ExpDec2 (= Bi-exponential Decay)",
  ExpDecay1: "ExpDecay1 (ExpDec1 with an x0 offset)",
  ExpDecay2: "ExpDecay2 (ExpDec2 with an x0 offset)",
  ExpDecay3: "ExpDecay3 (ExpDec3 with an x0 offset)",
  ExpGrow1: "ExpGrow1 (ExpGro1 with an x0 offset)",
  ExpGrow2: "ExpGrow2 (ExpGro2 with an x0 offset)",
  Gaussian: "Gaussian (height form; GaussAmp with y0 = 0)",
  Gauss: "Gauss (area form)",
  Lorentzian: "Lorentzian (height form)",
  Lorentz: "Lorentz (area form)",
  "Pseudo-Voigt": "Pseudo-Voigt (height form)",
  Logistic: "Logistic (exponential sigmoid in x)",
  "Logistic (Origin)": "Logistic (Origin: power of x)",
  Allometric: "Allometric (= Allometric1 for x > 0)",
  Poly5: "Poly 5",
  Poly: "Poly 9",
};

/** Registry models that draw EXACTLY the curve of an Origin built-in, with the
 *  same parameters in the same roles: the picker lists the Origin name once
 *  ("ExpDec1 (= Exponential Decay)") and hides this one, unless it is the
 *  model currently chosen (a saved fit may name it). Search still finds it. */
export const ALIAS_OF: Readonly<Record<string, string>> = {
  "Exponential Decay": "ExpDec1",
  "Exponential Growth": "ExpGro1",
  "Bi-exponential Decay": "ExpDec2",
};

export interface ModelOption {
  value: string;
  label: string;
}

export interface ModelGroup {
  group: string;
  options: ModelOption[];
}

/** The picker label for a registry model name. */
export function fitModelLabel(name: string): string {
  return DISPLAY[name] ?? name;
}

/** `models` under their headings, in Origin's order; registry order within a
 *  group. A category this file does not know keeps its own name, after the
 *  known ones — a new backend model is never dropped from the picker. */
export function groupFitModels(models: readonly FitModel[], keep?: string): ModelGroup[] {
  const groups = new Map<string, ModelOption[]>();
  const present = new Set(models.map((m) => m.name));
  for (const m of models) {
    // An alias is hidden when its Origin twin is listed, unless it is the current choice.
    const twin = ALIAS_OF[m.name];
    if (twin !== undefined && present.has(twin) && m.name !== keep) continue;
    const group = GROUP_OF[m.category] ?? m.category ?? "Other";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push({ value: m.name, label: fitModelLabel(m.name) });
  }
  const rank = (g: string) => (GROUP_ORDER.includes(g) ? GROUP_ORDER.indexOf(g) : GROUP_ORDER.length);
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([group, options]) => ({ group, options }));
}
