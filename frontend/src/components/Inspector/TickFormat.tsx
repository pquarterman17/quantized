// Inspector control: axis tick number format (the last piece of the W6 plot-
// state model). Auto = increment-aware adaptive labels (MAIN #20: our own
// override of uPlot's default formatter, which duplicated dense-tick labels —
// see uplotOpts.ts's autoTickValues doc); Fixed = N decimals; Sci = N-digit
// exponential; Eng = engineering notation (exponent a multiple of 3). Per X
// and Y; the Y format also drives the secondary axis. Applied in uplotOpts
// via axes[].values. Lives in the Axes card next to AxisLimits. Command-
// palette "Cycle X/Y tick format" (appCommands.ts) steps through all four.

import type { AxisFormat, TickMode } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { NumberField, SegmentedControl } from "../primitives";

const MODES: { value: TickMode; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "fixed", label: "Fixed" },
  { value: "sci", label: "Sci" },
  { value: "eng", label: "Eng" },
];

export default function TickFormat() {
  const xFmt = useApp((s) => s.xFmt);
  const yFmt = useApp((s) => s.yFmt);
  const setXFmt = useApp((s) => s.setXFmt);
  const setYFmt = useApp((s) => s.setYFmt);

  const row = (label: string, fmt: AxisFormat, set: (f: AxisFormat) => void) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
      <span className="qzk-field-lbl" style={{ margin: 0, width: 14 }}>
        {label}
      </span>
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
    </div>
  );

  return (
    <div style={{ marginTop: 8 }}>
      <span className="qzk-field-lbl">Tick format</span>
      {row("X", xFmt, setXFmt)}
      {row("Y", yFmt, setYFmt)}
    </div>
  );
}
