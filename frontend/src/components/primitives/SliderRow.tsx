// Split out of primitives/index.tsx (R8 bundle-diet pass, 2026-08-23) — see
// that file's header comment for why: every consumer is a lazy workshop or
// Inspector panel, so this must not live in the eager barrel.
import { type ReactNode, useId } from "react";

export function SliderRow({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  format,
  "aria-label": ariaLabel,
  onGestureStart,
}: {
  label: ReactNode;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange?: (value: number) => void;
  format?: (value: number) => ReactNode;
  /** Overrides the visible `label` as the slider's name when that is terse ("px"). */
  "aria-label"?: string;
  /** Called as a drag or a keyboard session begins (pointer-down, focus) --
   *  where a caller that coalesces its undo steps ends the previous run. */
  onGestureStart?: () => void;
}) {
  // The visible label names the slider unless an aria-label overrides it.
  const labelId = useId();
  return (
    <div className="qz-slider-row">
      <span id={labelId} className="qz-k">{label}</span>
      <input
        aria-label={ariaLabel}
        aria-labelledby={ariaLabel ? undefined : labelId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={onGestureStart}
        onFocus={onGestureStart}
        onChange={(e) => onChange?.(Number(e.target.value))}
      />
      <span className="qz-v">{format ? format(value) : value}</span>
    </div>
  );
}
