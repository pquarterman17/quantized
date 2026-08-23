// Axis tick-format controls for the canonical Publication Preview draft
// (F2.3e): the X, Y, and (when a secondary axis is plotted) Y2 number
// formats -- the same `AxisFormat` fields `Inspector/TickFormat.tsx` edits on
// the Stage, now reachable on the detached draft. The F2.3b/F2.3c/F2.3d
// precedent applied to tick formats.
//
// These already reach the renderer: `lib/figureSpec.ts` sends
// `x_fmt`/`y_fmt` via `axisFmtParam` and the y2 format via
// `secondaryAxisWire`. So before this panel a publication figure's tick
// notation could only be changed on the Stage -- the one action that
// invalidates an open preview session.
//
// The mode vocabulary and the date gating come from `lib/tickFormat.ts`,
// shared with the Inspector, so the two surfaces cannot drift into offering
// different formats for the same field.
//
// Y2 keeps the Stage's inherit rule verbatim: `y2Fmt === null` means "follow
// Y", which is what `resolveSecondaryAxis` applies on both the screen and the
// render. The checkbox seeds the current Y format when it is unticked, so
// turning inheritance off does not silently jump the axis to `auto`.

import {
  isDateTickMode,
  normalizeTickDigits,
  TICK_DATE_OPTIONS,
  TICK_MODE_OPTIONS,
} from "../../../lib/tickFormat";
import type { AxisFormat, TickMode } from "../../../lib/types";
import { Checkbox } from "../../primitives/Checkbox";
import { NumberField } from "../../primitives/NumberField";
import { SegmentedControl } from "../../primitives/SegmentedControl";

function AxisRow({
  axis,
  fmt,
  onChange,
  allowDate = false,
}: {
  axis: string;
  fmt: AxisFormat;
  onChange: (next: AxisFormat) => void;
  allowDate?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, width: "100%" }}>
      <span className="qzk-field-lbl" style={{ margin: 0, width: 18 }}>{axis}</span>
      <SegmentedControl<TickMode>
        options={TICK_MODE_OPTIONS}
        value={isDateTickMode(fmt.mode) ? "auto" : fmt.mode}
        onChange={(mode) => onChange({ ...fmt, mode })}
      />
      {allowDate && (
        <select
          className="qz-select"
          aria-label={`${axis} date/time format`}
          value={isDateTickMode(fmt.mode) ? fmt.mode : "numeric"}
          onChange={(event) =>
            onChange({
              ...fmt,
              mode: event.target.value === "numeric" ? "auto" : (event.target.value as TickMode),
            })
          }
        >
          {TICK_DATE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      )}
      {fmt.mode !== "auto" && !isDateTickMode(fmt.mode) && (
        <NumberField
          aria-label={`${axis} digits`}
          value={String(fmt.digits)}
          width={44}
          title="Decimal / mantissa digits"
          onChange={(raw) => {
            const digits = normalizeTickDigits(raw);
            if (digits !== null) onChange({ ...fmt, digits });
          }}
        />
      )}
    </div>
  );
}

export default function TickFormatPanel({
  xFmt,
  yFmt,
  y2Fmt,
  hasY2,
  xIsDate,
  onXFmt,
  onYFmt,
  onY2Fmt,
}: {
  xFmt: AxisFormat;
  yFmt: AxisFormat;
  /** null = inherit Y (the Stage's own default -- see PlotView's y2Fmt doc). */
  y2Fmt: AxisFormat | null;
  /** Whether the draft plots anything on a secondary axis. Without one the Y2
   *  row is a placebo -- `resolveSecondaryAxis` returns null and no y2_fmt is
   *  ever sent -- so it does not render, matching the Inspector card. */
  hasY2: boolean;
  /** Whether the bound data's X column was recognized as timestamps (or a
   *  date mode is already selected, so it stays switchable back). */
  xIsDate: boolean;
  onXFmt: (next: AxisFormat) => void;
  onYFmt: (next: AxisFormat) => void;
  onY2Fmt: (next: AxisFormat | null) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
      <AxisRow axis="X" fmt={xFmt} onChange={onXFmt} allowDate={xIsDate} />
      <AxisRow axis="Y" fmt={yFmt} onChange={onYFmt} />
      {hasY2 && (
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, width: "100%" }}>
          <span className="qzk-field-lbl" style={{ margin: 0, width: 18 }}>Y2</span>
          <Checkbox
            checked={y2Fmt === null}
            // Seeding from yFmt (not a fresh default) means unticking shows
            // the format the axis is ALREADY rendering, so the first edit is
            // a tweak rather than a surprise reset to Auto.
            onChange={(inherit) => onY2Fmt(inherit ? null : yFmt)}
          >
            inherits Y
          </Checkbox>
          {y2Fmt !== null && (
            <AxisRow axis="Y2" fmt={y2Fmt} onChange={(next) => onY2Fmt(next)} />
          )}
        </div>
      )}
    </div>
  );
}
