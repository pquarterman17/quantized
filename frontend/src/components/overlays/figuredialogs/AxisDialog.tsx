// Origin's Axis dialog (figures-audit #6): double-click an axis on the Stage
// (or Plot ▸ "Axis…") to edit its scale, limits, major increment, minor
// tick count, tick direction, tick-label number format, divide-by factor,
// fonts and (Y / Y2) an axis break in one place -- for X, Y and the secondary
// Y2 axis -- plus (gap-audit-2 #5) reverse, the axis' own grid, X label
// rotation, an outward offset and a top X axis showing 1/T, d-spacing or a
// linear map of X. Every field is
// an existing view field (axisDialogModel.ts), and the export carries the
// same values (`axisFmtParam` -> `calc/axis_extras.py`), so screen and
// export agree. Apply commits ONE undo step.

import { useState, type ReactNode } from "react";

import type { AxisId } from "../../../store/figureDialogs";
import { useApp } from "../../../store/useApp";
import type { TickMode } from "../../../lib/types";
import { commitAxisDraft, currentAxisDraft } from "../../../lib/figureDialogActions";
import { axisDraftErrors, type AxisDraft } from "../../../lib/axisDialogModel";

const AXIS_NAMES: Record<AxisId, string> = { x: "X axis", y: "Y axis", y2: "Y2 (right) axis" };

const SCALES: { value: AxisDraft["scale"]; label: string }[] = [
  { value: "linear", label: "Linear" },
  { value: "log", label: "Log10" },
  { value: "ln", label: "Ln" },
  { value: "reciprocal", label: "Reciprocal (1/x)" },
];
const MODES: { value: TickMode; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "fixed", label: "Decimal" },
  { value: "sci", label: "Scientific" },
  { value: "eng", label: "Engineering" },
];
const GRID_LINES: { value: AxisDraft["gridLines"]; label: string }[] = [
  { value: "plot", label: "As the plot (Grid on/off)" },
  { value: "none", label: "None" },
  { value: "major", label: "Major" },
  { value: "minor", label: "Minor" },
  { value: "both", label: "Major & minor" },
];
const DASHES: { value: AxisDraft["gridDash"]; label: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "dash", label: "Dash" },
  { value: "dot", label: "Dot" },
];
const TOP_KINDS: { value: AxisDraft["topKind"]; label: string }[] = [
  { value: "none", label: "None" },
  { value: "reciprocal", label: "Reciprocal (factor / x), e.g. 1/T" },
  { value: "dspacing", label: "d-spacing from 2θ (λ / 2 sin θ)" },
  { value: "linear", label: "Linear (factor · x + shift)" },
];
/** Cu Kα1, Å: the usual lab diffractometer, prefilled for d-spacing. */
const CU_KALPHA = "1.5406";
const TICKS: { value: AxisDraft["ticks"]; label: string }[] = [
  { value: "out", label: "Out" },
  { value: "in", label: "In" },
  { value: "both", label: "In & out" },
];

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="qzk-field-lbl" style={{ display: "grid", gridTemplateColumns: "130px 1fr", alignItems: "center", gap: 8 }}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export default function AxisDialog({ axis, onClose }: { axis: AxisId; onClose: () => void }) {
  const hasY2 = useApp((s) => (s.y2Keys?.length ?? 0) > 0);
  const [current, setCurrent] = useState<AxisId>(axis);
  const [draft, setDraft] = useState<AxisDraft>(() => currentAxisDraft(axis));
  const errors = axisDraftErrors(draft, current);
  const set = <K extends keyof AxisDraft>(k: K, v: AxisDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const text = (k: Exclude<keyof AxisDraft, "reverse">, label: string, placeholder = "auto") => (
    <Row label={label}>
      <input
        className="qz-input qz-num"
        aria-label={`${AXIS_NAMES[current]} ${label}`}
        value={draft[k]}
        placeholder={placeholder}
        onChange={(e) => set(k, e.target.value as never)}
      />
    </Row>
  );
  const select = <K extends "scale" | "mode" | "ticks" | "gridLines" | "gridDash" | "topKind">(k: K, label: string, options: { value: AxisDraft[K]; label: string }[]) => (
    <Row label={label}>
      <select
        className="qz-select"
        aria-label={`${AXIS_NAMES[current]} ${label}`}
        value={draft[k]}
        onChange={(e) => {
          const v = e.target.value as AxisDraft[K];
          set(k, v);
          if (k === "topKind" && v === "dspacing" && draft.topWavelength.trim() === "") set("topWavelength", CU_KALPHA);
        }}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Row>
  );
  const switchAxis = (next: AxisId) => {
    setCurrent(next);
    setDraft(currentAxisDraft(next));
  };
  const apply = () => {
    if (errors.length) return;
    commitAxisDraft(current, draft);
    onClose();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 360 }}>
      <div role="tablist" aria-label="Axis" style={{ display: "flex", gap: 4 }}>
        {(hasY2 ? (["x", "y", "y2"] as const) : (["x", "y"] as const)).map((a) => (
          <button
            key={a}
            type="button"
            role="tab"
            aria-selected={current === a}
            className={current === a ? "qz-btn qz-primary" : "qz-btn"}
            onClick={() => switchAxis(a)}
          >
            {a === "y2" ? "Y2" : a.toUpperCase()}
          </button>
        ))}
      </div>
      {!hasY2 && (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          No Y2 axis yet: put a series on the right axis (Channels ▸ Y2) to edit it here.
        </div>
      )}
      <h3 style={{ margin: "4px 0" }}>{AXIS_NAMES[current]} — scale</h3>
      {select("scale", "Type", SCALES)}
      {text("from", "From")}
      {text("to", "To")}
      <Row label="Reverse">
        <input
          type="checkbox"
          aria-label={`${AXIS_NAMES[current]} Reverse`}
          checked={draft.reverse}
          onChange={(e) => set("reverse", e.target.checked)}
        />
      </Row>
      {current === "x" ? (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          To break the X axis, use Plot ▸ Layout ▸ Break x-axis at gaps…
        </div>
      ) : (
        <>
          <h3 style={{ margin: "4px 0" }}>Break</h3>
          {text("breakFrom", "Break from", "none")}
          {text("breakTo", "Break to", "none")}
        </>
      )}
      <h3 style={{ margin: "4px 0" }}>Ticks</h3>
      {text("increment", "Major increment")}
      {text("minor", "Minor ticks", "0")}
      {select("ticks", "Direction", TICKS)}
      <h3 style={{ margin: "4px 0" }}>Tick labels</h3>
      {select("mode", "Number format", MODES)}
      {text("digits", "Digits", "2")}
      {text("divide", "Divide by", "1")}
      {text("size", "Label size (pt)")}
      {current === "x" && text("rotate", "Rotation (°)", "0")}
      {text("titleSize", "Title size (px)")}
      <h3 style={{ margin: "4px 0" }}>Line &amp; grid</h3>
      {text("offset", "Offset (pt)", "0")}
      {select("gridLines", "Grid lines", GRID_LINES)}
      {draft.gridLines !== "plot" && draft.gridLines !== "none" && (
        <>
          {text("gridColor", "Grid colour", "theme")}
          {select("gridDash", "Grid dash", DASHES)}
        </>
      )}
      {current === "x" && (
        <>
          <h3 style={{ margin: "4px 0" }}>Top axis</h3>
          {select("topKind", "Shows", TOP_KINDS)}
          {(draft.topKind === "reciprocal" || draft.topKind === "linear") && text("topFactor", "Factor", "1")}
          {draft.topKind === "linear" && text("topShift", "Shift", "0")}
          {draft.topKind === "dspacing" && text("topWavelength", "Wavelength (Å)", CU_KALPHA)}
          {draft.topKind !== "none" && text("topTitle", "Title", draft.topKind === "dspacing" ? "d (Å)" : "none")}
        </>
      )}
      {errors.length > 0 && (
        <div role="alert" className="qzk-ds-meta qzk-msg" style={{ color: "var(--danger)" }}>
          {errors.join(" ")}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 4 }}>
        <button type="button" className="qz-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="qz-btn qz-primary" onClick={apply} disabled={errors.length > 0}>Apply</button>
      </div>
    </div>
  );
}
