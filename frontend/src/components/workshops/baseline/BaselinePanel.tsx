// Baseline workshop — view. A draggable ToolWindow: pick a method (ALS / rolling
// ball / modpoly / SNIP / anchors / Shirley / XRD low-angle / analytic
// polynomials), tune its key params, and estimate the background under the
// active dataset. The baseline overlays on the plot; "Subtract" writes a new
// background-subtracted dataset to the library, while the anchor method's
// "Apply −BG" subtracts through the corrections chokepoint (replayable step +
// recalc DAG). Thin — logic lives in the hook.

import ToolWindow from "../../overlays/ToolWindow";
import { Button, NumberField, Select } from "../../primitives";
import { useApp } from "../../../store/useApp";
import { useBaseline, type BaselineMethod, type BaselineParams } from "./useBaseline";

const METHODS: { value: BaselineMethod; label: string }[] = [
  { value: "als", label: "Asymmetric least squares" },
  { value: "rollingball", label: "Rolling ball" },
  { value: "modpoly", label: "Modified polynomial" },
  { value: "snip", label: "SNIP" },
  { value: "region", label: "Fit from region" },
  { value: "anchor", label: "Anchor points" },
  { value: "shirley", label: "Shirley (XPS/XAS)" },
  { value: "xrdla", label: "XRD low-angle (1/x)" },
  { value: "linear", label: "Linear" },
  { value: "quadratic", label: "Quadratic" },
  { value: "poly", label: "Polynomial (n)" },
];

// Anchor interpolation choices — the backend's calc.backgrounds.anchor_baseline
// dispatch keys verbatim.
const ANCHOR_METHODS = [
  { value: "pchip", label: "pchip (shape-preserving)" },
  { value: "linear", label: "linear" },
  { value: "spline", label: "spline" },
];

interface ParamField {
  label: string;
  key: keyof BaselineParams;
  step?: number;
  allowEmpty?: boolean; // empty input -> NaN (region box edges: NaN = full range)
  placeholder?: string;
}

/** Which numeric param fields each method exposes (the anchor method's
 *  interpolation Select is separate — it isn't a NumberField). */
const FIELDS: Record<BaselineMethod, ParamField[]> = {
  als: [
    { label: "Smoothness λ", key: "lam" },
    { label: "Asymmetry p", key: "p", step: 0.001 },
  ],
  rollingball: [{ label: "Radius", key: "radius" }],
  modpoly: [{ label: "Poly order", key: "order" }],
  snip: [{ label: "Window (°)", key: "maxWindowDeg", step: 0.1 }],
  region: [
    { label: "Box x-min", key: "regionXMin", allowEmpty: true, placeholder: "auto" },
    { label: "Box x-max", key: "regionXMax", allowEmpty: true, placeholder: "auto" },
    { label: "Poly order", key: "order" },
  ],
  anchor: [],
  shirley: [{ label: "Max iterations", key: "maxIter" }],
  xrdla: [],
  linear: [],
  quadratic: [],
  poly: [{ label: "Poly order", key: "order" }],
};

export default function BaselinePanel() {
  const setOpen = useApp((s) => s.setBaselineOpen);
  const {
    active, method, params, baseline, busy, error, anchors, binding,
    setMethod, setParams, compute, subtract, clear, pickRegion, clearAnchors, applyAnchors,
  } = useBaseline();

  const close = () => {
    clear();
    setOpen(false);
  };

  return (
    <ToolWindow id="baseline" title="Baseline" width={320} onClose={close}>
      <label className="qzk-field-lbl">Method</label>
      <Select
        options={METHODS}
        value={method}
        onChange={(e) => setMethod(e.target.value as BaselineMethod)}
      />

      <div className="qzk-hint" style={{ marginTop: 6 }}>
        {binding ? `Analyzing ${binding.yLabel} vs ${binding.xLabel}` : "Select a plotted Y channel"}
      </div>

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
              value={Number.isFinite(params[f.key] as number) ? (params[f.key] as number) : ""}
              width={88}
              step={f.step}
              placeholder={f.placeholder}
              onChange={(v) => {
                if (f.allowEmpty && v.trim() === "") {
                  setParams({ [f.key]: Number.NaN });
                  return;
                }
                setParams({ [f.key]: Number(v) || 0 });
              }}
            />
          </span>
        ))}
      </div>

      {method === "region" && (
        <Button
          size="sm"
          disabled={!active}
          onClick={pickRegion}
          style={{ marginTop: 10, width: "100%" }}
        >
          ⬚ Pick range on plot
        </Button>
      )}

      {method === "anchor" && (
        <>
          <label className="qzk-field-lbl" style={{ marginTop: 10 }}>
            Interpolation
          </label>
          <Select
            options={ANCHOR_METHODS}
            value={params.anchorMethod}
            onChange={(e) => setParams({ anchorMethod: e.target.value })}
          />
          <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--text-faint)" }}>
            ◇ Click the plot to place anchors ({anchors.length} placed). Drag a
            marker to move it; click one to remove it.
          </div>
          <Button
            size="sm"
            disabled={anchors.length === 0}
            onClick={clearAnchors}
            style={{ marginTop: 8, width: "100%" }}
          >
            Clear anchors
          </Button>
        </>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <Button variant="primary" size="sm" disabled={!active || busy} onClick={() => void compute()}>
          {busy ? "Estimating…" : "Estimate"}
        </Button>
        {method === "anchor" ? (
          <Button
            size="sm"
            disabled={!active || busy || anchors.length < 2}
            onClick={() => void applyAnchors()}
          >
            Apply −BG
          </Button>
        ) : (
          <Button size="sm" disabled={!baseline} onClick={() => void subtract()}>
            Subtract →
          </Button>
        )}
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
          {method === "anchor"
            ? "Baseline overlaid — Apply −BG subtracts it as a correction step."
            : "Baseline overlaid — Subtract writes a new dataset."}
        </div>
      )}
    </ToolWindow>
  );
}
