// Lattice presets from imported CIF structures, for the XRD tools (Pawley's
// starting cell, the Crystal calculator's d-spacing cell). Pick an imported
// structure, or load a .cif here; the tool applies the derived LatticePreset.
// A CIF is a structure, not a dataset: see lib/crystalStructure.

import { useState } from "react";

import { uploadStructure } from "../../../lib/api/structures";
import { latticePreset, type LatticePreset } from "../../../lib/crystalStructure";
import { openFilePicker } from "../../../lib/openFilePicker";
import { presetLabel, useCrystalStructures, type StructurePreset } from "../../../store/crystalStructures";
import { Button, Select } from "../../primitives";

export default function StructurePresetPicker({ onApply, disabled = false }: {
  onApply: (preset: LatticePreset, source: StructurePreset) => void;
  disabled?: boolean;
}) {
  const presets = useCrystalStructures((s) => s.presets);
  const addStructure = useCrystalStructures((s) => s.addStructure);
  const [picked, setPicked] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const apply = (s: StructurePreset): void => {
    setPicked(s.id);
    const p = latticePreset(s);
    if ("error" in p) setError(`${s.name}: ${p.error}`);
    else {
      setError(null);
      onApply(p, s);
    }
  };

  const load = (files: File[]): void => {
    const file = files[0];
    if (!file) return;
    setLoading(true);
    setError(null);
    uploadStructure(file)
      .then((s) => apply(addStructure(s)))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "could not read the CIF"))
      .finally(() => setLoading(false));
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <Select
          aria-label="lattice preset"
          style={{ flex: 1, minWidth: 0 }}
          disabled={disabled || presets.length === 0}
          title={presets.length === 0 ? "Import a .cif to get a lattice preset." : undefined}
          options={[
            { value: "", label: presets.length ? "Lattice from CIF…" : "No CIF structures imported" },
            ...presets.map((s) => ({ value: s.id, label: presetLabel(s) })),
          ]}
          value={picked}
          onChange={(e) => {
            const s = presets.find((p) => p.id === e.target.value);
            if (s) apply(s);
          }}
        />
        <Button size="sm" disabled={disabled || loading} title="Read a unit cell from a CIF file."
          onClick={() => openFilePicker(load, ".cif")}>
          {loading ? "Loading…" : "Load CIF…"}
        </Button>
      </div>
      {error && <div className="qzk-ds-meta" role="alert" style={{ color: "var(--danger)", marginTop: 4 }}>{error}</div>}
    </div>
  );
}
