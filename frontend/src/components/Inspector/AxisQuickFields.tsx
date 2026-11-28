// UX-A (S5): a selected axis' key fields inline in the Inspector's Selection
// section — scale, limits and title for THAT axis — through the same store
// setters the Axes and Titles cards use. Everything else (ticks, breaks, top
// axis, fonts …) stays in the Axis dialog, one button away.
// Plan item 50: not mounted while `lib/objectEditorMode.ts` is "popup" (the
// Selection section offers Edit… for the Axis popup); kept for "panel" mode.

import { useEffect, useState } from "react";

import type { HalfLim } from "../../lib/axisLim";
import { limFieldDisplay, limFieldUnchanged, parseLimFields } from "../../lib/axisLimFields";
import type { AxisScale } from "../../lib/types";
import { openFigureDialog, type AxisId } from "../../store/figureDialogs";
import { useApp } from "../../store/useApp";
import { Select } from "../primitives";
import { NumberField } from "../primitives/NumberField";
import RichLabelInput from "../primitives/RichLabelInput";

export const AXIS_NAMES: Record<AxisId, string> = { x: "X axis", y: "Y axis", y2: "Y2 (right) axis" };
const SHORT: Record<AxisId, string> = { x: "X", y: "Y", y2: "Y2" };
const SCALES: { value: AxisScale; label: string }[] = [
  { value: "linear", label: "Linear" },
  { value: "log", label: "Log" },
  { value: "reciprocal", label: "Reciprocal" },
];
/** Y2 with no scale of its own follows Y. */
const SAME_AS_Y = "";

export default function AxisQuickFields({ axis }: { axis: AxisId }) {
  const scale = useApp((s) => (axis === "x" ? s.xScale : axis === "y" ? s.yScale : (s.y2Scale ?? SAME_AS_Y)));
  const lim: HalfLim | null = useApp((s) => (axis === "x" ? s.xLim : axis === "y" ? s.yLim : s.y2Lim));
  const title = useApp((s) => (axis === "x" ? s.xAxisLabel : axis === "y" ? s.yAxisLabel : s.y2AxisLabel));
  const st = {
    setXScale: useApp((s) => s.setXScale),
    setYScale: useApp((s) => s.setYScale),
    setY2Scale: useApp((s) => s.setY2Scale),
    setXLim: useApp((s) => s.setXLim),
    setYLim: useApp((s) => s.setYLim),
    setY2Lim: useApp((s) => s.setY2Lim),
    setXAxisLabel: useApp((s) => s.setXAxisLabel),
    setYAxisLabel: useApp((s) => s.setYAxisLabel),
    setY2AxisLabel: useApp((s) => s.setY2AxisLabel),
  };
  const short = SHORT[axis];

  const [lo, setLo] = useState(limFieldDisplay(lim, 0));
  const [hi, setHi] = useState(limFieldDisplay(lim, 1));
  useEffect(() => {
    setLo(limFieldDisplay(lim, 0));
    setHi(limFieldDisplay(lim, 1));
  }, [lim]);

  const setScale = (v: string) => {
    if (axis === "x") st.setXScale(v as AxisScale);
    else if (axis === "y") st.setYScale(v as AxisScale);
    else st.setY2Scale(v === SAME_AS_Y ? null : (v as AxisScale));
  };
  const commitLim = () => {
    if (limFieldUnchanged(lim, lo, hi)) return; // untouched: keep the full-precision limit
    const next = parseLimFields(lo, hi);
    if (next === undefined) return;
    if (axis === "x") st.setXLim(next);
    else if (axis === "y") st.setYLim(next);
    // Y2 takes a fully fixed range or none (its store field has no half-open form).
    else if (next === null || (next[0] != null && next[1] != null)) st.setY2Lim(next as [number, number] | null);
  };
  const setTitle = axis === "x" ? st.setXAxisLabel : axis === "y" ? st.setYAxisLabel : st.setY2AxisLabel;
  const limField = (side: "minimum" | "maximum", value: string, set: (v: string) => void) => (
    <NumberField
      value={value}
      width={88}
      title={value}
      placeholder="auto"
      aria-label={`Selected ${short} axis ${side}`}
      onChange={set}
      onBlur={commitLim}
      onKeyDown={(e) => e.key === "Enter" && commitLim()}
    />
  );

  return (
    <div className="qzk-sel-fields">
      <label className="qzk-field-lbl">
        Scale
        <Select
          aria-label={`Selected ${short} axis scale`}
          options={axis === "y2" ? [{ value: SAME_AS_Y, label: "Same as Y" }, ...SCALES] : SCALES}
          value={scale}
          onChange={(e) => setScale(e.target.value)}
        />
      </label>
      <span className="qzk-field-lbl">Limits</span>
      <div className="qzk-sel-row">
        {limField("minimum", lo, setLo)}
        <span className="qzk-sel-dash">–</span>
        {limField("maximum", hi, setHi)}
      </div>
      <span className="qzk-field-lbl">Title</span>
      <RichLabelInput value={title} name={`Selected ${short} axis title`} placeholder="auto" onCommit={setTitle} />
      <button type="button" className="qz-btn" onClick={() => openFigureDialog({ kind: "axis", axis })}>
        {AXIS_NAMES[axis]} settings…
      </button>
    </div>
  );
}
