// Reflectivity workshop — editable layer-stack table. Each row picks a material
// (SLD preset) and edits thickness + roughness. Row 0 is the incident medium and
// the last row the substrate (both have no meaningful thickness). Thin + stateless:
// all edits route back through the hook's callbacks.

import { IconButton, NumberField, Select } from "../../primitives";
import type { SldPreset } from "../../../lib/types";
import type { ModelLayer, Radiation } from "./useReflectivity";

function roleLabel(index: number, count: number): string {
  if (index === 0) return "Incident";
  if (index === count - 1) return "Substrate";
  return `Layer ${index}`;
}

export default function LayerTable({
  layers,
  presets,
  radiation,
  onUpdate,
  onRemove,
}: {
  layers: ModelLayer[];
  presets: SldPreset[];
  radiation: Radiation;
  onUpdate: (index: number, patch: Partial<ModelLayer>) => void;
  onRemove: (index: number) => void;
}) {
  const options = presets.map((p) => ({ value: p.name, label: p.name }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div
        className="qzk-ds-meta"
        style={{ display: "grid", gridTemplateColumns: "62px 1fr 56px 56px 20px", gap: 6 }}
      >
        <span>role</span>
        <span>material</span>
        <span>t (Å)</span>
        <span>σ (Å)</span>
        <span />
      </div>
      {layers.map((row, i) => {
        const isEnd = i === 0 || i === layers.length - 1;
        const p = presets.find((x) => x.name === row.preset);
        const sld = p ? (radiation === "xray" ? p.sldX : p.sldN) : row.sld;
        return (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "62px 1fr 56px 56px 20px",
              gap: 6,
              alignItems: "center",
            }}
          >
            <span
              className="qzk-ds-meta"
              title={`SLD ${sld.toExponential(3)} Å⁻²`}
              style={{ color: "var(--text-dim)" }}
            >
              {roleLabel(i, layers.length)}
            </span>
            <Select
              options={options}
              value={row.preset}
              onChange={(e) => onUpdate(i, { preset: e.target.value })}
            />
            <NumberField
              value={isEnd ? "—" : row.thickness}
              width={50}
              disabled={isEnd}
              onChange={(v) => onUpdate(i, { thickness: Number(v) || 0 })}
            />
            <NumberField
              value={i === 0 ? "—" : row.roughness}
              width={50}
              disabled={i === 0}
              onChange={(v) => onUpdate(i, { roughness: Number(v) || 0 })}
            />
            <IconButton
              title="Remove layer"
              disabled={isEnd || layers.length <= 2}
              onClick={() => onRemove(i)}
            >
              ✕
            </IconButton>
          </div>
        );
      })}
    </div>
  );
}
