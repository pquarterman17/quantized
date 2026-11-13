// Peak Analyzer wizard — the small field helpers every step body uses (the
// labelled numeric field and the clamp router), moved out of steps.tsx when
// step ① got its own module (StepRangeBaseline.tsx) so both can share them.

import { useState } from "react";

import { NumberField } from "../../primitives/NumberField";

export const faint = { color: "var(--text-faint)" } as const;

/** A labelled numeric field: local text echo, commits parsed finite values
 *  (or null when cleared) upward on change. */
/** Route a `Num` edit through one of `peakClamp`'s rules: a null (empty)
 *  field or a rejected value leaves the recipe as it was, so every value that
 *  reaches `patchRecipe` is one the recipe-file importer will accept back. */
export function clamped(rule: (v: number) => number | null, apply: (v: number) => void): (v: number | null) => void {
  return (v) => {
    if (v === null) return;
    const c = rule(v);
    if (c !== null) apply(c);
  };
}

export function Num({
  label,
  value,
  onValue,
  placeholder,
  width = 84,
}: {
  label?: string;
  value: number | null;
  onValue: (v: number | null) => void;
  placeholder?: string;
  width?: number;
}) {
  const [text, setText] = useState(
    value === null || Number.isNaN(value) ? "" : String(value),
  );
  const field = (
    <NumberField
      value={text}
      placeholder={placeholder}
      width={width}
      onChange={(t) => {
        setText(t);
        if (t.trim() === "") onValue(null);
        else {
          const v = Number(t);
          if (Number.isFinite(v)) onValue(v);
        }
      }}
    />
  );
  if (!label) return field;
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
      <label className="qzk-field-lbl">{label}</label>
      {field}
    </span>
  );
}
