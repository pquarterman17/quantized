// Film stack -> Reflectivity hand-off (THIN_FILM_STACK_PLANNING_PLAN G4), the
// pure half: turn a StackSeed into a new Parratt layer list, and say when a
// seeded model must not be simulated or fitted yet. No React, no store.
//
// Provisional, owner to confirm: the incident medium is the "Air / Vacuum"
// preset; every seeded interface roughness is SEED_ROUGHNESS_A (the same 3 Å
// the workshop already gives a new film or an SLD-calculator layer) and is
// marked to fit; SLDs are only ever the stack's computed values, else blank.

import type { StackSeed } from "../../../store/workshopFlags";
import type { ModelLayer, Radiation } from "./useReflectivity";

/** The roughness the workshop already uses for a new film (addLayer, SLD seed). */
export const SEED_ROUGHNESS_A = 3;

/** The incident medium row: the workshop's own default first row. */
const INCIDENT: ModelLayer = { preset: "Air / Vacuum", thickness: 0, roughness: 0, sld: 0 };

/** The new model: incident medium, the stack's layers top to bottom, substrate
 *  last. An uncomputable SLD stays 0 but is flagged `sldPending`; a computed
 *  one is a manual SLD for `radiation` (remembered in `sldProbe`). */
export function stackToModelLayers(seed: StackSeed, radiation: Radiation): ModelLayer[] {
  const rows = seed.stack.map((l, i): ModelLayer => {
    const isSubstrate = i === seed.stack.length - 1;
    const sld = radiation === "xray" ? l.sld.xray : l.sld.neutron;
    const row: ModelLayer = {
      preset: "",
      thickness: isSubstrate ? 0 : (l.thicknessA ?? 0),
      roughness: SEED_ROUGHNESS_A,
      sld: sld ?? 0,
      fitRoughness: true,
    };
    if (sld == null) return { ...row, sldPending: true };
    return {
      ...row,
      sldProbe: radiation,
      ...(radiation === "xray" && l.sld.xrayAbs != null ? { isld: l.sld.xrayAbs } : {}),
    };
  });
  return [INCIDENT, ...rows];
}

/** Why this model cannot be simulated or fitted yet, or null. A pending SLD
 *  would be simulated as 0 (silently wrong), and a seeded SLD is valid only
 *  for the radiation it was computed for. Choosing a material clears both. */
export function seededModelBlock(layers: ModelLayer[], radiation: Radiation): string | null {
  const pending = layers.flatMap((l, i) => (l.sldPending ? [i] : []));
  if (pending.length > 0) {
    return `SLD not set for layer ${pending.join(", ")} (the stack has no composition + density for it): pick a material.`;
  }
  const stale = layers.findIndex((l) => l.sldProbe != null && l.sldProbe !== radiation);
  if (stale >= 0) {
    return `Layer ${stale} SLD was computed for ${layers[stale].sldProbe}: switch Radiation back or pick a material.`;
  }
  return null;
}
