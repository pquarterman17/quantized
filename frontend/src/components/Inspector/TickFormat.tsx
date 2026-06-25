// Inspector control: axis tick number format (the last piece of the W6 plot-
// state model). Auto = uPlot's adaptive labels; Fixed = N decimals; Sci = N-digit
// exponential. Per X and Y; the Y format also drives the secondary axis. Applied
// in uplotOpts via axes[].values. Lives in the Axes card next to AxisLimits.

import type { AxisFormat, TickMode } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { NumberField, SegmentedControl } from "../primitives";

const MODES: { value: TickMode; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "fixed", label: "Fixed" },
  { value: "sci", label: "Sci" },
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
