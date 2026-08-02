import { useEffect, useState } from "react";

import { NumberField } from "../../primitives";

/** A labelled numeric field that retains valid in-progress typing while
 * reflecting externally replaced canonical-draft values. */
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
  const [text, setText] = useState(value === undefined ? "" : String(value));
  const committedText = value === undefined ? "" : String(value);
  useEffect(() => {
    setText(committedText);
  }, [committedText]);

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
      <label className="qzk-field-lbl">{label}</label>
      <NumberField
        aria-label={ariaLabel ?? label}
        value={text}
        width={width}
        min={min}
        max={max}
        required={required}
        onBlur={() => {
          const next = Number(text);
          if (
            required &&
            (text.trim() === "" ||
              !Number.isFinite(next) ||
              (min !== undefined && next < min) ||
              (max !== undefined && next > max))
          ) setText(committedText);
        }}
        onChange={(next) => {
          setText(next);
          if (next.trim() === "") onValue(undefined);
          else {
            const numeric = Number(next);
            if (
              Number.isFinite(numeric) &&
              (min === undefined || numeric >= min) &&
              (max === undefined || numeric <= max)
            ) onValue(numeric);
          }
        }}
      />
    </span>
  );
}
