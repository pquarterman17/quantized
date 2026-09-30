// Imported crystal structures (CIF), kept as LATTICE PRESETS for the XRD
// tools — Pawley's starting cell and the Crystal calculator's d-spacing cell.
//
// A standalone store, not a useApp slice: a structure is not a dataset (no
// sampled axis, so no DataStruct — see lib/crystalStructure), it never enters
// the Library, and only lazy chunks (the import slice, the Pawley section,
// the Crystal tab) read it, so it stays out of the eager bundle.
//
// SESSION-ONLY: presets are not written into a saved project. The cell a
// preset fills in IS saved wherever it is used (Pawley records its starting
// cell in the derived dataset's metadata), which is what provenance needs.
// Re-importing the same file replaces its earlier preset instead of stacking
// duplicates.

import { create } from "zustand";

import type { CrystalStructure } from "../lib/api/structures";

export interface StructurePreset extends CrystalStructure {
  id: string;
}

interface CrystalStructuresState {
  presets: StructurePreset[];
  addStructure: (s: CrystalStructure) => StructurePreset;
}

let seq = 0;

export const useCrystalStructures = create<CrystalStructuresState>((set, get) => ({
  presets: [],
  addStructure: (s) => {
    const prior = get().presets.find((p) => p.source_name === s.source_name && p.name === s.name);
    const preset: StructurePreset = { ...s, id: prior?.id ?? `cif-${++seq}` };
    set((st) => ({
      presets: prior ? st.presets.map((p) => (p.id === prior.id ? preset : p)) : [...st.presets, preset],
    }));
    return preset;
  },
}));

/** A preset's one-line label: name, formula and space group when known. */
export function presetLabel(p: CrystalStructure): string {
  const extra = [p.formula, p.space_group].filter((v) => v && v !== "?").join(", ");
  return extra ? `${p.name} (${extra})` : p.name;
}
