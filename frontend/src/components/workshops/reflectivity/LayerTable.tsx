// Reflectivity workshop — editable layer-stack table. Each row picks a material
// (SLD preset) and edits thickness + roughness. Row 0 is the incident medium and
// the last row the substrate (both have no meaningful thickness). A film row may
// instead be a graded (spline) SLD profile, edited in a lazily loaded
// GradedLayerEditor under the row. Thin + stateless: all edits route back
// through the hook's callbacks.

import { IconButton } from "../../primitives/IconButton";
import { NumberField } from "../../primitives/NumberField";
import { Select } from "../../primitives";
import { lazyRegion } from "../../../lib/lazyRegion";
import type { SldPreset } from "../../../lib/types";
import { resolveLayer } from "./reflFitModel";
import type { ModelLayer, Radiation } from "./useReflectivity";

const GradedLayerEditor = lazyRegion(() => import("./GradedLayerEditor"), "Graded layer");

// The material select's value for a graded row (never a preset name).
const GRADED = "graded";

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
  // "" = a manual SLD row (seeded from the SLD calculator, or written by the
  // fit's "Apply to model" when a fitted SLD left its preset's value).
  const options = [{ value: "", label: "Manual SLD" }, ...presets.map((p) => ({ value: p.name, label: p.name }))];
  const filmOptions = [...options, { value: GRADED, label: "Graded (spline)" }];

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
        const graded = !isEnd ? row.graded : undefined;
        const { sld, isld } = resolveLayer(row, presets, radiation);
        // Switching to Manual keeps the row's current SLD instead of zeroing it;
        // graded starts flat at that SLD (graded slabs carry no absorption).
        const onMaterial = (value: string) =>
          onUpdate(
            i,
            value === GRADED
              ? { preset: "", sld, isld: 0, graded: { knots: [sld, sld], method: "pchip" } }
              : value === ""
                ? { preset: "", sld, isld, graded: undefined }
                : { preset: value, graded: undefined },
          );
        return (
          <div key={i} style={{ display: "contents" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "62px 1fr 56px 56px 20px",
                gap: 6,
                alignItems: "center",
              }}
            >
              <span
                className="qzk-ds-meta"
                title={graded ? "Graded SLD profile" : `SLD ${sld.toExponential(3)} Å⁻²`}
                style={{ color: "var(--text-dim)" }}
              >
                {roleLabel(i, layers.length)}
              </span>
              <Select
                options={isEnd ? options : filmOptions}
                value={graded ? GRADED : row.preset}
                onChange={(e) => onMaterial(e.target.value)}
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
                aria-label="Remove layer"
                title="Remove layer"
                disabled={isEnd || layers.length <= 2}
                onClick={() => onRemove(i)}
              >
                ✕
              </IconButton>
            </div>
            {graded && (
              <GradedLayerEditor layer={i} graded={graded} onChange={(g) => onUpdate(i, { graded: g })} />
            )}
          </div>
        );
      })}
    </div>
  );
}
