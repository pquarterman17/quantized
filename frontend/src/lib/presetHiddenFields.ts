// Preset settings a tool's current mode HIDES (Baseline's radius under SNIP, an Outlier threshold outside MAD,
// Resample's step outside the step mode). The user cannot see such a field, so a save must not refuse over it
// (acceptance 8 U1) and must not store a value its own check refuses. Two helpers, shared by the adapters that
// have mode-dependent fields: `looseChecks` relaxes the hidden fields to a type check, `storeHidden` replaces a
// hidden value that fails its strict check with the default. The stored shape is unchanged (every key present),
// so older presets and the adapter contract keep working.

import type { FieldCheck } from "./presetAdapter";

type Spec<S> = { [K in keyof S & string]: FieldCheck };

/** `spec` with each hidden field checked by its `loose` (type-only) check instead of the strict one. */
export function looseChecks<S extends object>(spec: Spec<S>, hidden: readonly (keyof S & string)[], loose: Partial<Spec<S>>): Spec<S> {
  const out = { ...spec };
  for (const key of hidden) out[key] = loose[key] ?? out[key];
  return out;
}

/** `settings` with every hidden field that fails its strict check set to its default. */
export function storeHidden<S extends object>(settings: S, spec: Spec<S>, hidden: readonly (keyof S & string)[], defaults: S): S {
  const out = { ...settings };
  for (const key of hidden) if (spec[key](settings[key]) !== null) out[key] = defaults[key];
  return out;
}
