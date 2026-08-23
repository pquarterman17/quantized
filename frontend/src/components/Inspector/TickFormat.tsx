// Inspector control: axis tick number format (the last piece of the W6 plot-
// state model). Auto = increment-aware adaptive labels (MAIN #20: our own
// override of uPlot's default formatter, which duplicated dense-tick labels —
// see uplotOpts.ts's autoTickValues doc); Fixed = N decimals; Sci = N-digit
// exponential; Eng = engineering notation (exponent a multiple of 3). Per X
// and Y; the secondary (Y2) axis INHERITS the Y format by default (y2Fmt
// null) but can be set independently once a y2 channel is plotted — see the
// Y2 row below and store/useApp.ts's y2Fmt doc. Applied in uplotOpts via
// axes[].values. Lives in the Axes card next to AxisLimits. Command-palette
// "Cycle X/Y tick format" (appCommands.ts) steps through all four (X/Y only).

// The mode lists + date gating are shared with the canonical Publication
// Preview's TickFormatPanel (F2.3e) via lib/tickFormat.ts -- both surfaces
// must offer the same four modes or a figure's ticks change meaning
// depending on which panel the user reached for.
import {
  isDateTickMode,
  normalizeTickDigits,
  TICK_DATE_OPTIONS,
  TICK_MODE_OPTIONS as MODES,
  xAxisIsDate,
} from "../../lib/tickFormat";
import type { AxisFormat, TickMode } from "../../lib/types";
import { useActiveDataset, useApp } from "../../store/useApp";
import { Checkbox } from "../primitives/Checkbox";
import { NumberField } from "../primitives/NumberField";
import { SegmentedControl } from "../primitives/SegmentedControl";

export default function TickFormat() {
  const xFmt = useApp((s) => s.xFmt);
  const yFmt = useApp((s) => s.yFmt);
  const y2Fmt = useApp((s) => s.y2Fmt);
  const y2Keys = useApp((s) => s.y2Keys);
  const setXFmt = useApp((s) => s.setXFmt);
  const setYFmt = useApp((s) => s.setYFmt);
  const setY2Fmt = useApp((s) => s.setY2Fmt);

  const controls = (fmt: AxisFormat, set: (f: AxisFormat) => void, allowDate = false) => (
    <>
      <SegmentedControl<TickMode>
        options={MODES}
        value={fmt.mode}
        onChange={(mode) => set({ ...fmt, mode })}
      />
      {allowDate && (
        <select
          className="qz-select"
          aria-label="X date/time format"
          value={isDateTickMode(fmt.mode) ? fmt.mode : "numeric"}
          onChange={(event) => set({ ...fmt, mode: event.target.value === "numeric" ? "auto" : event.target.value as TickMode })}
        >
          {TICK_DATE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      )}
      {fmt.mode !== "auto" && !isDateTickMode(fmt.mode) && (
        <NumberField
          value={String(fmt.digits)}
          width={44}
          title="Decimal / mantissa digits"
          onChange={(v) => {
            const digits = normalizeTickDigits(v);
            if (digits !== null) set({ ...fmt, digits });
          }}
        />
      )}
    </>
  );

  const row = (label: string, fmt: AxisFormat, set: (f: AxisFormat) => void, allowDate = false) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
      <span className="qzk-field-lbl" style={{ margin: 0, width: 14 }}>
        {label}
      </span>
      {controls(fmt, set, allowDate)}
    </div>
  );

  const hasY2 = (y2Keys?.length ?? 0) > 0;

  // Offer the Date/Time X-axis modes ONLY when the active dataset's X column
  // was recognized as timestamps on import (metadata.time_is_datetime). A date
  // format applied to a physics X-axis produces out-of-range epochs that used
  // to crash the export; gating it here is the primary fix (the formatter also
  // degrades safely as a backstop). Stays available if a saved spec already
  // selected a date mode, so it can be switched back.
  const active = useActiveDataset();
  const xIsDate = xAxisIsDate(active?.data.metadata, xFmt.mode);

  return (
    <div style={{ marginTop: 8 }}>
      <span className="qzk-field-lbl">Tick format</span>
      {row("X", xFmt, setXFmt, xIsDate)}
      {row("Y", yFmt, setYFmt)}
      {hasY2 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
          <span className="qzk-field-lbl" style={{ margin: 0, width: 14 }}>
            Y2
          </span>
          <Checkbox checked={y2Fmt === null} onChange={(inherit) => setY2Fmt(inherit ? null : yFmt)}>
            inherits Y
          </Checkbox>
          {y2Fmt !== null && controls(y2Fmt, setY2Fmt)}
        </div>
      )}
    </div>
  );
}
