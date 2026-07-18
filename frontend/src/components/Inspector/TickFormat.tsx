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

import type { AxisFormat, TickMode } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { Checkbox, NumberField, SegmentedControl } from "../primitives";

const MODES: { value: TickMode; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "fixed", label: "Fixed" },
  { value: "sci", label: "Sci" },
  { value: "eng", label: "Eng" },
];

export default function TickFormat() {
  const xFmt = useApp((s) => s.xFmt);
  const yFmt = useApp((s) => s.yFmt);
  const y2Fmt = useApp((s) => s.y2Fmt);
  const y2Keys = useApp((s) => s.y2Keys);
  const setXFmt = useApp((s) => s.setXFmt);
  const setYFmt = useApp((s) => s.setYFmt);
  const setY2Fmt = useApp((s) => s.setY2Fmt);

  const controls = (fmt: AxisFormat, set: (f: AxisFormat) => void) => (
    <>
      <SegmentedControl<TickMode>
        options={MODES}
        value={fmt.mode}
        onChange={(mode) => set({ ...fmt, mode })}
      />
      {fmt.mode !== "auto" && (
        <NumberField
          value={String(fmt.digits)}
          width={44}
          title="Decimal / mantissa digits"
          onChange={(v) => {
            if (v.trim() === "") return;
            const n = Number(v);
            if (Number.isFinite(n)) set({ ...fmt, digits: Math.max(0, Math.min(20, Math.round(n))) });
          }}
        />
      )}
    </>
  );

  const row = (label: string, fmt: AxisFormat, set: (f: AxisFormat) => void) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
      <span className="qzk-field-lbl" style={{ margin: 0, width: 14 }}>
        {label}
      </span>
      {controls(fmt, set)}
    </div>
  );

  const hasY2 = (y2Keys?.length ?? 0) > 0;

  return (
    <div style={{ marginTop: 8 }}>
      <span className="qzk-field-lbl">Tick format</span>
      {row("X", xFmt, setXFmt)}
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
