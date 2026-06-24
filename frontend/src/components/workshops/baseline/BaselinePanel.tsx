// Baseline workshop — view. A draggable ToolWindow: pick a method (ALS / rolling
// ball / modpoly / SNIP), tune its key params, and estimate the background under
// the active dataset. The baseline overlays on the plot; "Subtract" writes a new
// background-subtracted dataset to the library. Thin — logic lives in the hook.

import ToolWindow from "../../overlays/ToolWindow";
import { Button, NumberField, Select } from "../../primitives";
import { useApp } from "../../../store/useApp";
import { useBaseline, type BaselineMethod, type BaselineParams } from "./useBaseline";

const METHODS: { value: BaselineMethod; label: string }[] = [
  { value: "als", label: "Asymmetric least squares" },
  { value: "rollingball", label: "Rolling ball" },
  { value: "modpoly", label: "Modified polynomial" },
  { value: "snip", label: "SNIP" },
];

/** Which param fields each method exposes (label + key + step). */
const FIELDS: Record<BaselineMethod, { label: string; key: keyof BaselineParams; step?: number }[]> =
  {
    als: [
      { label: "Smoothness λ", key: "lam" },
      { label: "Asymmetry p", key: "p", step: 0.001 },
    ],
    rollingball: [{ label: "Radius", key: "radius" }],
    modpoly: [{ label: "Poly order", key: "order" }],
    snip: [{ label: "Window (°)", key: "maxWindowDeg", step: 0.1 }],
  };

export default function BaselinePanel() {
  const setOpen = useApp((s) => s.setBaselineOpen);
  const { active, method, params, baseline, busy, error, setMethod, setParams, compute, subtract, clear } =
    useBaseline();

  const close = () => {
    clear();
    setOpen(false);
  };

  return (
    <ToolWindow title="Baseline" width={320} onClose={close}>
      <label className="qzk-field-lbl">Method</label>
      <Select
        options={METHODS}
        value={method}
        onChange={(e) => setMethod(e.target.value as BaselineMethod)}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto auto",
          gap: "6px 12px",
          marginTop: 10,
          alignItems: "center",
        }}
      >
        {FIELDS[method].map((f) => (
          <span key={f.key} style={{ display: "contents" }}>
            <label className="qzk-field-lbl" style={{ margin: 0 }}>
              {f.label}
            </label>
            <NumberField
              value={params[f.key]}
              width={88}
              step={f.step}
              onChange={(v) => setParams({ [f.key]: Number(v) || 0 })}
            />
          </span>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <Button variant="primary" size="sm" disabled={!active || busy} onClick={() => void compute()}>
          {busy ? "Estimating…" : "Estimate"}
        </Button>
        <Button size="sm" disabled={!baseline} onClick={subtract}>
          Subtract →
        </Button>
      </div>

      {!active && (
        <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--text-faint)" }}>
          Select a dataset first.
        </div>
      )}
      {error && (
        <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--danger)" }}>
          {error}
        </div>
      )}
      {baseline && !error && (
        <div className="qzk-ds-meta" style={{ marginTop: 10, color: "var(--text-faint)" }}>
          Baseline overlaid — Subtract writes a new dataset.
        </div>
      )}
    </ToolWindow>
  );
}
