// Origin's Axis dialog (figures-audit #6): double-click an axis on the Stage
// (or Plot ▸ "Axis…") to edit its scale, limits, major increment, minor
// tick count, tick direction, tick-label number format, divide-by factor and
// fonts in one place -- for X, Y and the secondary Y2 axis. Every field is
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
  const text = (k: keyof AxisDraft, label: string, placeholder = "auto") => (
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
  const select = <K extends "scale" | "mode" | "ticks">(k: K, label: string, options: { value: AxisDraft[K]; label: string }[]) => (
    <Row label={label}>
      <select className="qz-select" aria-label={`${AXIS_NAMES[current]} ${label}`} value={draft[k]} onChange={(e) => set(k, e.target.value as AxisDraft[K])}>
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
            className="qz-btn"
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
      <h3 style={{ margin: "4px 0" }}>Scale</h3>
      {select("scale", "Type", SCALES)}
      {text("from", "From")}
      {text("to", "To")}
      <h3 style={{ margin: "4px 0" }}>Ticks</h3>
      {text("increment", "Major increment")}
      {text("minor", "Minor ticks", "0")}
      {select("ticks", "Direction", TICKS)}
      <h3 style={{ margin: "4px 0" }}>Tick labels</h3>
      {select("mode", "Number format", MODES)}
      {text("digits", "Digits", "2")}
      {text("divide", "Divide by", "1")}
      {text("size", "Label size (pt)")}
      {text("titleSize", "Title size (px)")}
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
