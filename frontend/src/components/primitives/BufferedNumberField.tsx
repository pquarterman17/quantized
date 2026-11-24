import { NumberField } from "./NumberField";
import { useCommitDraft } from "./useCommitDraft";

/** A numeric field whose DOM value is a local text buffer, not the store
 *  number it edits (see `useCommitDraft`).
 *
 *  Why a buffer: binding `value` to `String(storeNumber)` with a
 *  per-keystroke "parse, write if finite" onChange snaps the input back to
 *  the OLD digits on every invalid intermediate keystroke (typing "-" commits
 *  nothing, so the next keystroke lands appended to the old number: editing
 *  1 to -5 produced 15, and Select-All+Backspace could not clear the field).
 *
 *  Commit semantics (2026-11-24): the value is written ONCE, on Enter or on
 *  blur of edited text, so "1.2345" is one undo step and one redraw, not one
 *  per keystroke on half-typed values. Esc reverts; a blur of unedited text
 *  writes nothing; non-numeric or out-of-[min, max] input reverts. A blank
 *  buffer reverts when `required`, otherwise commits `onValue(undefined)`
 *  (the caller's "cleared"). A numerically unchanged edit ("1.50" for 1.5)
 *  writes nothing.
 *
 *  `live` opts back in to the old write-per-valid-keystroke behaviour, for a
 *  field whose caller shows a live preview of the typed value (the Function
 *  Plot workshop, whose curve follows its parameters). Enter/blur still
 *  revert an invalid buffer. Default off: everything else commits once. */
export default function BufferedNumberField({
  value,
  onValue,
  required = false,
  live = false,
  width,
  min,
  max,
  onFocus,
  onBlur,
  onKeyDown,
  ...rest
}: {
  value: number | undefined;
  onValue: (v: number | undefined) => void;
  /** Revert a blank buffer to the last committed value instead of clearing. */
  required?: boolean;
  /** Write on every valid keystroke (live preview) instead of on Enter/blur. */
  live?: boolean;
  width?: number;
  min?: number;
  max?: number;
} & Omit<React.ComponentProps<typeof NumberField>, "value" | "onChange" | "width" | "min" | "max">) {
  const committed = value === undefined ? "" : String(value);

  // undefined = invalid (revert); null = valid blank; number = valid value.
  const parse = (text: string): number | null | undefined => {
    if (text.trim() === "") return required ? undefined : null;
    const n = Number(text);
    if (!Number.isFinite(n) || (min !== undefined && n < min) || (max !== undefined && n > max)) return undefined;
    return n;
  };
  const write = (text: string): string | null => {
    const p = parse(text);
    if (p === undefined) return null;
    const next = p === null ? undefined : p;
    if (next !== value) onValue(next);
    return next === undefined ? "" : String(next);
  };

  const { text, inputProps } = useCommitDraft(committed, write, live);

  return (
    <NumberField
      value={text}
      width={width}
      min={min}
      max={max}
      required={required}
      {...rest}
      onFocus={(e) => {
        inputProps.onFocus();
        onFocus?.(e);
      }}
      onBlur={(e) => {
        inputProps.onBlur(e);
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (!e.defaultPrevented) inputProps.onKeyDown(e);
      }}
      onChange={inputProps.onChange}
    />
  );
}
