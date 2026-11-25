// A numeric Preferences row that refuses what is out of range and SAYS so
// (the BootstrapCapPref pattern, shared by General and Fitting): the stored
// value only ever changes to a valid number; an invalid entry keeps the old
// value, shows why, and snaps back on blur.

import { useState } from "react";

import { NumberField } from "../primitives/NumberField";

export interface PrefNumberRowProps {
  label: string;
  hint?: string;
  /** The current stored value (read live by the caller, e.g. `slot.use()`). */
  value: number;
  /** The number if `text` is acceptable, else null. */
  parse: (text: string) => number | null;
  /** The range, for the refusal message ("0.4 to 10"). */
  range: string;
  onSave: (n: number) => void;
  unit?: string;
  width?: number;
}

export default function PrefNumberRow({ label, hint, value, parse, range, onSave, unit, width = 88 }: PrefNumberRowProps) {
  const [text, setText] = useState<string | null>(null); // null = show the stored value
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="qzk-pref-row">
      <div className="qzk-pref-lbl">
        {label}
        {hint && <span className="hint">{hint}</span>}
      </div>
      <div className="qzk-pref-ctl">
        <NumberField
          aria-label={label}
          aria-invalid={note ? true : undefined}
          value={text ?? String(value)}
          width={width}
          unit={unit}
          onChange={(t) => {
            setText(t);
            const n = t.trim() === "" ? null : parse(t.replace(/,/g, ""));
            if (n === null) {
              setNote(`Use ${range}. Still ${value}.`);
              return;
            }
            setNote(null);
            onSave(n);
          }}
          onBlur={() => {
            setText(null);
            setNote(null);
          }}
        />
        {note && (
          <span className="hint qzk-pref-warn" role="alert">
            {note}
          </span>
        )}
      </div>
    </div>
  );
}
