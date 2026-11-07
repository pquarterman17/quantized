// Lattice presets from the built-in reference phase table (calc.phase_database,
// a port of MATLAB calc.crystal.phaseDatabase): 52 common substrate and film
// phases. The sibling StructurePresetPicker does the same for imported CIFs.
// Picking a phase hands the caller a LatticePreset; nothing else changes.
//
// The table is fetched once per session and shared by every picker (a failed
// fetch is not cached, so a later mount retries). The displayed choice is
// controlled by the caller (`selected`), which clears it when the user edits
// the values the phase filled in, so the label never claims a stale origin.

import { useEffect, useState } from "react";

import { getPhases, type PhaseInfo } from "../../../lib/api/reference";
import { crystalSystemOf, pawleyTieOf, type Cell, type LatticePreset } from "../../../lib/crystalStructure";
import { Select } from "../../primitives";

let cachedPhases: PhaseInfo[] | null = null;

/** Test hook: forget the session cache. */
export function resetPhaseCacheForTests(): void {
  cachedPhases = null;
}

function loadPhases(): Promise<PhaseInfo[]> {
  if (cachedPhases) return Promise.resolve(cachedPhases);
  return getPhases().then((r) => {
    cachedPhases = r.phases ?? [];
    return cachedPhases;
  });
}

/** The preset a reference phase gives (its own centering; system from the cell). */
export function phasePreset(p: PhaseInfo): LatticePreset {
  const cell: Cell = { a: p.a, b: p.b, c: p.c, alpha: p.alpha, beta: p.beta, gamma: p.gamma };
  return { cell, tie: pawleyTieOf(cell), centering: p.centering, system: crystalSystemOf(cell) };
}

export default function PhasePresetPicker({
  onApply,
  selected,
  label = "reference phase",
}: {
  onApply: (preset: LatticePreset, phase: PhaseInfo) => void;
  /** The phase name to show as chosen; "" shows the placeholder. */
  selected: string;
  label?: string;
}) {
  const [phases, setPhases] = useState<PhaseInfo[]>(() => cachedPhases ?? []);

  useEffect(() => {
    let live = true;
    loadPhases()
      .then((list) => {
        if (live) setPhases(list);
      })
      .catch(() => {
        /* offline: no phase presets; typed values still work */
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <Select
      aria-label={label}
      style={{ width: "100%" }}
      disabled={phases.length === 0}
      options={[
        { value: "", label: phases.length ? "Lattice from reference phase…" : "Reference phases unavailable" },
        ...phases.map((p) => ({ value: p.name, label: `${p.name} — ${p.category} (a = ${p.a} Å)` })),
      ]}
      value={phases.some((p) => p.name === selected) ? selected : ""}
      onChange={(e) => {
        const p = phases.find((x) => x.name === e.target.value);
        if (p) onApply(phasePreset(p), p);
      }}
    />
  );
}
