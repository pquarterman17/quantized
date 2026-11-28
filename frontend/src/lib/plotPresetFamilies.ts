// The gallery groups its variant tiles by FAMILY: the plot type each variant
// opens (so "Violin + median" sits under "Violin", "Split violin" under
// "Half violin"). The family label is the parent type's own label, never a
// second hand-typed name, and tiles keep their declaration order inside it.

import { PLOT_TYPES, type PlotTypeId } from "./plotTypes";
import { PLOT_PRESETS, type PlotPresetDef } from "./plotTypePresets";

/** A family shows this many tiles; the rest sit behind its "more" fold. */
export const FAMILY_VISIBLE = 3;

export interface PresetFamily {
  parent: PlotTypeId;
  label: string;
  presets: PlotPresetDef[];
}

/** The families under one gallery group, in the order of its plot types;
 *  a type with no variants has no family. */
export function presetFamilies(types: readonly PlotTypeId[]): PresetFamily[] {
  const out: PresetFamily[] = [];
  for (const parent of types) {
    const presets = PLOT_PRESETS.filter((p) => p.parent === parent);
    if (presets.length) out.push({ parent, label: PLOT_TYPES.find((t) => t.id === parent)?.label ?? parent, presets });
  }
  return out;
}
