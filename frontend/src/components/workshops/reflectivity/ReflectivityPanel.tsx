// Reflectivity workshop — view. A draggable ToolWindow with two modes sharing
// one layer model (layers, radiation, presets):
//   Model — build a layer stack from SLD presets, pick a Q grid, and simulate
//           R(Q) / the SLD profile into the library (plot it on a log-Y axis).
//   Fit   — fit that same stack to a measured XRR/PNR dataset (ReflFitView).
// Thin by design — all state/logic lives in the hooks. Both hooks live HERE so
// switching modes never discards the model or a fit result.

import { useState } from "react";

import ToolWindow from "../../overlays/ToolWindow";
import { NumberField } from "../../primitives/NumberField";
import { SegmentedControl } from "../../primitives/SegmentedControl";
import { Button } from "../../primitives";
import { useApp } from "../../../store/useApp";
import LayerTable from "./LayerTable";
import ReflFitView from "./ReflFitView";
import { useReflFit } from "./useReflFit";
import { useReflectivity, type Radiation } from "./useReflectivity";

type Mode = "model" | "fit";

export default function ReflectivityPanel() {
  const setOpen = useApp((s) => s.setReflectivityOpen);
  const [mode, setMode] = useState<Mode>("model");
  const refl = useReflectivity();
  const fit = useReflFit(refl);
  const { presets, layers, radiation, grid, busy, error } = refl;
  const { setRadiation, setGrid, updateLayer, addLayer, removeLayer, simulate, sldProfile } = refl;

  return (
    <ToolWindow id="reflectivity" title="Reflectivity" width={480} onClose={() => setOpen(false)}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <SegmentedControl<Mode>
          options={[
            { value: "model", label: "Model" },
            { value: "fit", label: "Fit" },
          ]}
          value={mode}
          onChange={setMode}
        />
        <label className="qzk-field-lbl" style={{ margin: 0, marginLeft: "auto" }}>
          Radiation
        </label>
        <SegmentedControl<Radiation>
          options={[
            { value: "xray", label: "X-ray" },
            { value: "neutron", label: "Neutron" },
          ]}
          value={radiation}
          onChange={setRadiation}
        />
      </div>

      <LayerTable
        layers={layers}
        presets={presets}
        radiation={radiation}
        onUpdate={updateLayer}
        onRemove={removeLayer}
      />

      <div style={{ marginTop: 8 }}>
        <Button size="sm" variant="ghost" onClick={addLayer}>
          + Add layer
        </Button>
      </div>

      {mode === "fit" ? (
        <ReflFitView fit={fit} />
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "auto auto",
              gap: "6px 14px",
              marginTop: 12,
              alignItems: "center",
            }}
          >
            <label className="qzk-field-lbl" style={{ margin: 0 }}>
              Q range (Å⁻¹)
            </label>
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <NumberField value={grid.qMin} width={64} onChange={(v) => setGrid({ qMin: Number(v) || 0 })} />
              <span style={{ color: "var(--text-faint)" }}>–</span>
              <NumberField value={grid.qMax} width={64} onChange={(v) => setGrid({ qMax: Number(v) || 0 })} />
            </span>

            <label className="qzk-field-lbl" style={{ margin: 0 }}>
              Points
            </label>
            <NumberField
              value={grid.nPoints}
              width={64}
              onChange={(v) => setGrid({ nPoints: Math.max(2, Math.round(Number(v) || 0)) })}
            />

            <label className="qzk-field-lbl" style={{ margin: 0, textTransform: "none" }}>
              Resolution dQ/Q
            </label>
            <NumberField
              value={grid.resolution}
              width={64}
              onChange={(v) => setGrid({ resolution: Math.max(0, Number(v) || 0) })}
            />
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <Button variant="primary" size="sm" disabled={busy} onClick={() => void simulate()}>
              {busy ? "Simulating…" : "Simulate R(Q)"}
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void sldProfile()}>
              SLD profile
            </Button>
          </div>

          {error && (
            <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--danger)" }}>
              {error}
            </div>
          )}
          <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--text-faint)" }}>
            Adds the model to the library — view it on a log-Y axis.
          </div>
        </>
      )}
    </ToolWindow>
  );
}
