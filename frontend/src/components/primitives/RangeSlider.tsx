// RangeSlider — dual-thumb range slider (ORIGIN_GAP #53 item 7a). Two
// overlapping `<input type="range">` elements, the accessible classic for
// this control (each thumb keeps native keyboard support: arrows/Home/End/
// Page). The crossing-thumb math (a drag never pushes lo past hi or vice
// versa) is the pure lib/rangeslider so it's unit-tested independent of the
// DOM. Split out of primitives/index.tsx (re-exported there) to keep that
// barrel file under the ~400-line convention.

import type { CSSProperties } from "react";

import { clampHigh, clampLow } from "../../lib/rangeslider";

export interface RangeSliderProps {
  min: number;
  max: number;
  lo: number;
  hi: number;
  /** 0 (default) = continuous (native `step="any"`). */
  step?: number;
  onChange: (lo: number, hi: number) => void;
  loLabel?: string;
  hiLabel?: string;
}

export function RangeSlider({
  min,
  max,
  lo,
  hi,
  step = 0,
  onChange,
  loLabel = "minimum",
  hiLabel = "maximum",
}: RangeSliderProps) {
  const pct = (v: number) => (max > min ? ((v - min) / (max - min)) * 100 : 0);
  const stepAttr = step > 0 ? step : "any";
  return (
    <div
      className="qz-range-slider"
      style={
        {
          "--qz-range-lo": `${pct(lo)}%`,
          "--qz-range-hi": `${pct(hi)}%`,
        } as CSSProperties
      }
    >
      <div className="qz-range-track" />
      <div className="qz-range-fill" />
      <input
        type="range"
        aria-label={loLabel}
        min={min}
        max={max}
        step={stepAttr}
        value={lo}
        onChange={(e) => {
          const r = clampLow(Number(e.target.value), hi, min, max, step);
          onChange(r.lo, r.hi);
        }}
      />
      <input
        type="range"
        aria-label={hiLabel}
        min={min}
        max={max}
        step={stepAttr}
        value={hi}
        onChange={(e) => {
          const r = clampHigh(Number(e.target.value), lo, min, max, step);
          onChange(r.lo, r.hi);
        }}
      />
    </div>
  );
}
