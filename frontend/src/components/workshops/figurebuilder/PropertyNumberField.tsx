import BufferedNumberField from "../../primitives/BufferedNumberField";

/** A labelled numeric field that retains valid in-progress typing while
 * reflecting externally replaced canonical-draft values. The buffer-commit
 * logic itself now lives in the shared `BufferedNumberField` primitive (also
 * used unlabelled by the Inspector decor cards' row fields) — this component
 * is just that primitive plus the visible `<label>` this panel's dense field
 * grid needs. */
export default function PropertyNumberField({
  label,
  ariaLabel,
  value,
  onValue,
  width = 64,
  min,
  max,
  required = false,
}: {
  label: string;
  /** Overrides the accessible name when it must stay fuller/unique than the
   *  visible `label` text (e.g. a dense per-index field list where the
   *  visible text drops a repeated "annotation N " prefix). Defaults to
   *  `label`. */
  ariaLabel?: string;
  value: number | undefined;
  onValue: (v: number | undefined) => void;
  width?: number;
  min?: number;
  max?: number;
  /** Required coordinates retain their last finite value if cleared or invalid. */
  required?: boolean;
}) {
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
      <label className="qzk-field-lbl">{label}</label>
      <BufferedNumberField
        aria-label={ariaLabel ?? label}
        value={value}
        onValue={onValue}
        width={width}
        min={min}
        max={max}
        required={required}
      />
    </span>
  );
}
