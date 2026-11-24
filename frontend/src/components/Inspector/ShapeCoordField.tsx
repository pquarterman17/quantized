// One shape endpoint coordinate (UX11-C N10). Same idea as the axis-limit
// fields (`lib/axisLimFields`: `limFieldDisplay` / `limFieldUnchanged`): a dragged
// endpoint is a full double ("0.007617511520737328"), so the field SHOWS it
// rounded to 5 significant digits, but only while it is neither focused nor
// edited. On focus it shows the exact text and keeps whatever is typed. The
// value is committed (at full precision, ONE undo step) on Enter, or on blur
// if the text was edited; Esc reverts. A blur of untouched text never writes,
// so the rounded display cannot replace the exact value. The tooltip carries
// the full value.

import { useRef, useState } from "react";

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
  const skipBlur = useRef(false);
  // Write the draft if it is a changed, valid number; always leave edit mode
  // unless `keep` (Enter keeps focus, showing the exact new value).
  const commit = (keep: boolean) => {
    const n = Number(draft);
    const changed = draft !== null && draft.trim() !== "" && Number.isFinite(n) && draft !== String(value);
    if (changed) onValue(n);
    setDraft(keep && changed ? String(n) : keep ? draft : null);
  };
  return (
    <NumberField
      value={draft ?? coordDisplay(value)}
      width={width}
      placeholder={label.split(" ").at(-1)}
      aria-label={label}
      title={String(value)}
      required
      onFocus={() => setDraft(String(value))}
      onBlur={() => {
        if (skipBlur.current) skipBlur.current = false;
        else commit(false);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit(true);
        else if (e.key === "Escape" && draft !== null) {
          // Revert; nothing else (the window's Escape) should also act.
          e.stopPropagation();
          skipBlur.current = true;
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
      onChange={setDraft}
    />
  );
}
