// Inspector control: X/Y axis scale (MAIN #12) — Linear/Log/Reciprocal, a
// 3-way pick replacing the old plain "Log X/Y axis" checkboxes. Lives in the
// Axes card, alongside AxisLimits/TickFormat. "Reciprocal" positions by 1/x
// (uPlot custom distr) while tick labels stay in the original data units —
// see lib/uplotOpts.ts's reciprocalTransform/reciprocalAxisSplits for the
// screen-side math and calc/figure_scale.py for the matplotlib export
// counterpart.

import { useApp } from "../../store/useApp";
import type { AxisScale } from "../../lib/types";
import { Select } from "../primitives";

const AXIS_SCALE_OPTIONS: { value: AxisScale; label: string }[] = [
  { value: "linear", label: "Linear" },
  { value: "log", label: "Log" },
  { value: "reciprocal", label: "Reciprocal" },
];

export default function AxisScaleControls() {
  const xScale = useApp((s) => s.xScale);
  const yScale = useApp((s) => s.yScale);
  const setXScale = useApp((s) => s.setXScale);
  const setYScale = useApp((s) => s.setYScale);

  return (
    <>
      <label className="qzk-field-lbl">
        X scale
        <Select
          options={AXIS_SCALE_OPTIONS}
          value={xScale}
          onChange={(e) => setXScale(e.target.value as AxisScale)}
        />
      </label>
      <label className="qzk-field-lbl" style={{ marginTop: 2 }}>
        Y scale
        <Select
          options={AXIS_SCALE_OPTIONS}
          value={yScale}
          onChange={(e) => setYScale(e.target.value as AxisScale)}
        />
      </label>
    </>
  );
}
