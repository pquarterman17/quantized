// One shape endpoint coordinate (UX11-C N10). Same pattern as the axis-limit
// fields (`lib/axisLimFields`: `limFieldDisplay` / `limFieldUnchanged`): a dragged
// endpoint is a full double ("0.007617511520737328"), so the field SHOWS it
// rounded to 5 significant digits, but only while it is neither focused nor
// edited. On focus it shows the exact text; whatever the user types is kept as
// typed and a valid number is written at full precision. A blur never writes
// (an untouched field cannot re-commit the rounded text over the exact value).
// The tooltip carries the full value.

import { useState } from "react";

import { NumberField } from "../primitives/NumberField";

export const coordDisplay = (v: number): string => String(Number(v.toPrecision(5)));

export default function ShapeCoordField({
  value,
  onValue,
  label,
  width = 92,
}: {
  value: number;
  onValue: (v: number) => void;
  label: string;
  width?: number;
}) {
  // null = not focused/edited: show the rounded committed value.
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <NumberField
      value={draft ?? coordDisplay(value)}
      width={width}
      placeholder={label.split(" ").at(-1)}
      aria-label={label}
      title={String(value)}
      required
      onFocus={() => setDraft(String(value))}
      onBlur={() => setDraft(null)}
      onChange={(t) => {
        setDraft(t);
        const n = Number(t);
        if (t.trim() !== "" && Number.isFinite(n)) onValue(n);
      }}
    />
  );
}
