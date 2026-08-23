// The Corrections card's rescale block (MAIN_PLAN #37) — ×/÷ factors for X and
// Y, their validation notes, and the optional axis relabel that rides the same
// Apply. Split out of CorrectionsCard.tsx to keep that file under the ~400-line
// component ceiling: the card was at 409 with this inline.
//
// Deliberately presentational — it owns no state. The pure conversion and
// validation live in lib/rescale.ts, the form state stays in CorrectionsCard,
// so this file can be read as "what the rescale controls look like" and
// nothing else.

import { NumberField } from "../primitives/NumberField";
import { Select } from "../primitives";
import type { ScaleOp } from "../../lib/rescale";

const SCALE_OPS: { value: ScaleOp; label: ScaleOp }[] = [
  { value: "×", label: "×" },
  { value: "÷", label: "÷" },
];

/** One labelled row of the Inspector's key/value grid. Mirrors the private
 *  `Field` in CorrectionsCard — duplicated rather than exported so the card
 *  keeps a single local definition and this file stays self-contained. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="qz-meta-row">
      <span className="qz-k">{label}</span>
      <span className="qz-v">{children}</span>
    </div>
  );
}

/** Inline validation note. `role="alert"` so the reason Apply is disabled is
 *  announced, not merely coloured — same convention as the fit convergence
 *  warnings. */
function FieldNote({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="qz-meta-row" style={{ color: "var(--danger, #d33)" }}>
      {children}
    </div>
  );
}

export interface RescaleFieldsProps {
  xScaleOp: ScaleOp;
  xScaleVal: string;
  yScaleOp: ScaleOp;
  yScaleVal: string;
  xLabelText: string;
  yLabelText: string;
  /** Human-readable reason the entry is unusable, from `lib/rescale`. */
  xScaleIssue?: string;
  yScaleIssue?: string;
  onChange: (
    key: "xScaleOp" | "xScaleVal" | "yScaleOp" | "yScaleVal" | "xLabelText" | "yLabelText",
    value: string,
  ) => void;
}

export default function RescaleFields(p: RescaleFieldsProps) {
  // The relabel rows appear only while a scale is being set — that is exactly
  // when a unit string is about to stop matching the numbers.
  const scaling = p.xScaleVal.trim() !== "" || p.yScaleVal.trim() !== "";
  return (
    <>
      <Field label="X scale">
        <div style={{ display: "flex", gap: 4 }}>
          <Select
            options={SCALE_OPS}
            value={p.xScaleOp}
            onChange={(e) => p.onChange("xScaleOp", e.target.value)}
            style={{ width: 52 }}
            title="Multiply or divide the X axis by a factor"
          />
          <NumberField
            value={p.xScaleVal}
            placeholder="1"
            onChange={(v) => p.onChange("xScaleVal", v)}
          />
        </div>
      </Field>
      {p.xScaleIssue && <FieldNote>X scale {p.xScaleIssue}</FieldNote>}
      <Field label="Y scale">
        <div style={{ display: "flex", gap: 4 }}>
          <Select
            options={SCALE_OPS}
            value={p.yScaleOp}
            onChange={(e) => p.onChange("yScaleOp", e.target.value)}
            style={{ width: 52 }}
            title="Multiply or divide every Y channel (error channels scale with them)"
          />
          <NumberField
            value={p.yScaleVal}
            placeholder="1"
            onChange={(v) => p.onChange("yScaleVal", v)}
          />
        </div>
      </Field>
      {p.yScaleIssue && <FieldNote>Y scale {p.yScaleIssue}</FieldNote>}
      {scaling && (
        <>
          <Field label="X label">
            <NumberField
              numeric={false}
              value={p.xLabelText}
              placeholder="keep current"
              title="Rename the X axis with this scale — blank keeps the current label"
              onChange={(v) => p.onChange("xLabelText", v)}
            />
          </Field>
          <Field label="Y label">
            <NumberField
              numeric={false}
              value={p.yLabelText}
              placeholder="keep current"
              title="Rename the Y axis with this scale — blank keeps the current label"
              onChange={(v) => p.onChange("yLabelText", v)}
            />
          </Field>
        </>
      )}
    </>
  );
}
