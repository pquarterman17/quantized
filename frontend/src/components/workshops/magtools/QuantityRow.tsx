// One `value | unit` row of the sample profile (MAIN_PLAN #42). The input and
// its unit select each carry a unique accessible name; an invalid value is
// marked `aria-invalid` and described by its own per-field error text.

import { NumberField } from "../../primitives/NumberField";
import { Select } from "../../primitives";
import { FIELD_SPECS, type ProfileField } from "../../../lib/sampleGeometry";

const HINTS: Partial<Record<ProfileField, string>> = {
  filmThickness: "Magnetic layer only — not the substrate or total-sample thickness.",
};

export function QuantityRow(props: {
  field: ProfileField;
  text: string;
  unit: string;
  error?: string;
  onText: (text: string) => void;
  onUnit: (unit: string) => void;
}) {
  const { field, text, unit, error } = props;
  const spec = FIELD_SPECS[field];
  const id = `mag-norm-${field}`;
  const errId = `${id}-error`;
  const hint = HINTS[field];
  const hintId = `${id}-hint`;
  const describedBy = [hint ? hintId : "", error ? errId : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className="qz-mag-quantity-row">
      <div className="qz-mag-geometry-row">
        <label className="qzk-field-lbl" htmlFor={id}>{spec.label}</label>
        <NumberField
          id={id}
          value={text}
          width={88}
          inputMode="decimal"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={props.onText}
        />
        <Select
          aria-label={`${spec.label} unit`}
          options={spec.units.map((u) => ({ value: u, label: u }))}
          value={unit}
          onChange={(e) => props.onUnit(e.target.value)}
        />
      </div>
      {hint && <div id={hintId} className="qzk-ds-meta qz-mag-field-hint">{hint}</div>}
      {error && <div id={errId} className="qzk-ds-meta qz-mag-field-error">{error}</div>}
    </div>
  );
}
