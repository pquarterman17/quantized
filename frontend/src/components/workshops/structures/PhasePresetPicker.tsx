// Lattice presets from the built-in reference phase table (calc.phase_database,
// a port of MATLAB calc.crystal.phaseDatabase): 52 common substrate and film
// phases. The sibling StructurePresetPicker does the same for imported CIFs.
// Picking a phase hands the caller a LatticePreset; nothing else changes.

import { useEffect, useState } from "react";

import { getPhases, type PhaseInfo } from "../../../lib/api/reference";
import { crystalSystemOf, pawleyTieOf, type Cell, type LatticePreset } from "../../../lib/crystalStructure";
import { Select } from "../../primitives";

/** The preset a reference phase gives (its own centering; system from the cell). */
export function phasePreset(p: PhaseInfo): LatticePreset {
  const cell: Cell = { a: p.a, b: p.b, c: p.c, alpha: p.alpha, beta: p.beta, gamma: p.gamma };
  return { cell, tie: pawleyTieOf(cell), centering: p.centering, system: crystalSystemOf(cell) };
}

export default function PhasePresetPicker({
  onApply,
  label = "reference phase",
}: {
  onApply: (preset: LatticePreset, phase: PhaseInfo) => void;
  label?: string;
}) {
  const [phases, setPhases] = useState<PhaseInfo[]>([]);
  const [picked, setPicked] = useState("");

  useEffect(() => {
    let live = true;
    getPhases()
      .then((r) => {
        if (live) setPhases(r.phases ?? []);
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
      value={picked}
      onChange={(e) => {
        const p = phases.find((x) => x.name === e.target.value);
        setPicked(e.target.value);
        if (p) onApply(phasePreset(p), p);
      }}
    />
  );
}
