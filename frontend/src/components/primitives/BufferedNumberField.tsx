import { useEffect, useState } from "react";

import { NumberField } from "./index";

/** A numeric field whose DOM value is a local text buffer, not the store
 *  number it edits. Fixes a class of wrong-result bug: binding `value`
 *  directly to `String(storeNumber)` with a per-keystroke "parse, and only
 *  write back if finite" onChange snaps the controlled input back to the
 *  OLD digits on every invalid intermediate keystroke (typing "-" commits
 *  nothing, so the field's value prop reverts to the last committed number)
 *  — the next keystroke then lands appended to THAT instead of the
 *  in-progress "-": editing 1 to -5 silently produced 15, and
 *  Select-All+Backspace couldn't even clear the field.
 *
 *  Decoupling the DOM value into local `text` state (synced from the
 *  committed value only via the effect below, never written to on every
 *  keystroke) lets an in-progress "-" or "" stay visible without snapping
 *  back; a keystroke that resolves to a valid, in-range number commits via
 *  `onValue` immediately (so Enter needs no special handling — the last
 *  valid value is already live by the time it's pressed). `required`
 *  reverts a blank/invalid buffer to the last committed value on blur —
 *  right for a coordinate that can never actually be `undefined` in the
 *  store; leave it false for a field whose caller treats blank as
 *  `onValue(undefined)`.
 *
 *  This is the buffer-commit-on-valid-keystroke logic `PropertyNumberField`
 *  (workshops/figurebuilder) already got right for the Publication Preview
 *  panels, extracted here so every numeric row field — including the
 *  Inspector decor cards' — shares ONE implementation instead of a fourth
 *  reimplementation of the same bug. */
export default function BufferedNumberField({
  value,
  onValue,
  required = false,
  width,
  min,
  max,
  ...rest
}: {
  value: number | undefined;
  onValue: (v: number | undefined) => void;
  /** Revert a blank/invalid buffer to the last committed value on blur. */
  required?: boolean;
  width?: number;
  min?: number;
  max?: number;
} & Omit<React.ComponentProps<typeof NumberField>, "value" | "onChange" | "width" | "min" | "max">) {
  const committedText = value === undefined ? "" : String(value);
  const [text, setText] = useState(committedText);
  useEffect(() => {
    setText(committedText);
  }, [committedText]);

  return (
    <NumberField
      value={text}
      width={width}
      min={min}
      max={max}
      required={required}
      {...rest}
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
  );
}
