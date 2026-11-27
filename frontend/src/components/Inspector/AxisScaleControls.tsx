// Inspector control: X/Y axis scale (MAIN #12) — Linear/Log/Reciprocal, a
// 3-way pick replacing the old plain "Log X/Y axis" checkboxes. Lives in the
// Axes card, alongside AxisLimits/TickFormat. "Reciprocal" positions by 1/x
// (uPlot custom distr) while tick labels stay in the original data units —
// see lib/uplotOpts.ts's reciprocalTransform/reciprocalAxisSplits for the
// screen-side math and calc/figure_scale.py for the matplotlib export
// counterpart.

import { useApp } from "../../store/useApp";
import type { AxisFormat } from "../../lib/axisFormat";
import type { AxisScale } from "../../lib/types";
import { Select } from "../primitives";

const AXIS_SCALE_OPTIONS: { value: AxisScale; label: string }[] = [
  { value: "linear", label: "Linear" },
  { value: "log", label: "Log" },
  { value: "reciprocal", label: "Reciprocal" },
];

/** A probability type (set in the Axis dialog) is drawn instead of the stored linear scale, so the control
 *  names it: an extra entry while it is active. Picking Linear / Log / Reciprocal replaces it. */
const PROB_OPTION = { fraction: { value: "probit", label: "Probability (0–1)" }, percent: { value: "probitPct", label: "Probability (%)" } } as const;
const scaleChoice = (scale: AxisScale, fmt: AxisFormat): string => (fmt.prob ? PROB_OPTION[fmt.prob].value : scale);
const scaleOptions = (fmt: AxisFormat) => (fmt.prob ? [...AXIS_SCALE_OPTIONS, PROB_OPTION[fmt.prob]] : AXIS_SCALE_OPTIONS);

export default function AxisScaleControls() {
  const xScale = useApp((s) => s.xScale);
  const yScale = useApp((s) => s.yScale);
  const xFmt = useApp((s) => s.xFmt);
  const yFmt = useApp((s) => s.yFmt);
  const xReversed = useApp((s) => s.xReversed);
  const setXScale = useApp((s) => s.setXScale);
  const setYScale = useApp((s) => s.setYScale);
  const recordHistory = useApp((s) => s.recordHistory);
  // Reverse X (IR wavenumber convention, `PlotView.xReversed`) is written here,
  // in the lazy Inspector, not through an eager store action (the ChannelsCard
  // precedent): one history entry, then the live view field.
  const setXReversed = (v: boolean) => {
    recordHistory("reverse x axis");
    useApp.setState({ xReversed: v });
  };

  // Choosing a scale while a probability type is active replaces that type (one undo step).
  const pick = (axis: "x" | "y", value: string): void => {
    if (value === "probit" || value === "probitPct") return; // the entry that names the active type
    const fmt = axis === "x" ? xFmt : yFmt;
    if (!fmt.prob) return axis === "x" ? setXScale(value as AxisScale) : setYScale(value as AxisScale);
    const { prob: _prob, ...rest } = fmt;
    void _prob;
    recordHistory(`change ${axis.toUpperCase()} scale`);
    useApp.setState(axis === "x" ? { xScale: value as AxisScale, xFmt: rest } : { yScale: value as AxisScale, yFmt: rest });
  };

  return (
    <>
      <label className="qzk-field-lbl">
        X scale
        <Select
          options={scaleOptions(xFmt)}
          value={scaleChoice(xScale, xFmt)}
          onChange={(e) => pick("x", e.target.value)}
        />
      </label>
      <label className="qz-check" title="Draw x from high to low, as IR spectra are read.">
        <input type="checkbox" checked={xReversed} onChange={(e) => setXReversed(e.target.checked)} />
        Reverse X
      </label>
      <label className="qzk-field-lbl" style={{ marginTop: 2 }}>
        Y scale
        <Select
          options={scaleOptions(yFmt)}
          value={scaleChoice(yScale, yFmt)}
          onChange={(e) => pick("y", e.target.value)}
        />
      </label>
    </>
  );
}
