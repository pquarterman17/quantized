// Bars for one series (Origin column / bar graph creation): None / Vertical /
// Horizontal over `SeriesStyle.bars`. The canvas draws it in lib/uplotBars.ts
// (horizontal turns the plot, lib/uplotOrient.ts); the export in
// calc/figure_bars.py + calc/figure_orient.py. The series colour above fills
// the bars. Turning bars on clears the markers and fill-under, as the
// plot-type gallery's bar tiles do. "Floats from the series above" makes this
// bar span the previous plotted series' value to its own (Origin's floating
// column; `SeriesStyle.float`, lib/uplotStack.floatLowColumn): the series above
// becomes the bar's low end and draws nothing itself.

import type { SeriesStyle } from "../../lib/types";
import { Select } from "../primitives";

type BarsChoice = "none" | "vertical" | "horizontal";

const OPTIONS: { value: BarsChoice; label: string }[] = [
  { value: "none", label: "None" },
  { value: "vertical", label: "Vertical" },
  { value: "horizontal", label: "Horizontal" },
];

const choiceOf = (b: SeriesStyle["bars"]): BarsChoice => (b === "horizontal" ? "horizontal" : b ? "vertical" : "none");

export default function SeriesBarsControl({
  channel, style, setSeriesStyle, above, aboveStyle,
}: {
  channel: number;
  style: SeriesStyle;
  /** The plotted channel drawn just before this one, and its style (a floating bar's low end). */
  above?: number;
  aboveStyle?: SeriesStyle;
  setSeriesStyle: (channel: number, patch: Partial<SeriesStyle>, coalesce?: string) => void;
}) {
  const floating = style.float === "high";
  // A series can be a bar's low end or its high end, not both, and the series
  // above must be free to be a low end (not the high of an earlier pair).
  const canFloat = !!style.bars && above !== undefined && style.float !== "low" && aboveStyle?.float !== "high";
  const toggleFloat = (on: boolean) => {
    if (above === undefined) return;
    if (on) {
      setSeriesStyle(above, { float: "low", bars: style.bars, marker: false, fill: undefined });
      setSeriesStyle(channel, { float: "high", stack: undefined });
    } else {
      setSeriesStyle(above, { float: undefined });
      setSeriesStyle(channel, { float: undefined });
    }
  };
  return (
    <>
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
      <span className="qzk-field-lbl" style={{ margin: 0 }}>Bars</span>
      <Select
        options={OPTIONS}
        value={choiceOf(style.bars)}
        title="Draw this series as bars from zero at each X"
        aria-label="Bars"
        onChange={(e) => {
          const v = e.target.value as BarsChoice;
          if (v === "none") {
            if (floating && above !== undefined) setSeriesStyle(above, { float: undefined });
            setSeriesStyle(channel, { bars: undefined, float: undefined });
          }
          else setSeriesStyle(channel, { bars: v === "horizontal" ? "horizontal" : true, marker: false, fill: undefined });
        }}
      />
    </div>
    <label
      style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, opacity: canFloat || floating ? 1 : 0.5 }}
      title="Each bar spans the series above's value to this series' value (a floating column); the series above draws nothing itself"
    >
      <input type="checkbox" checked={floating} disabled={!canFloat && !floating} onChange={(e) => toggleFloat(e.target.checked)} />
      <span className="qzk-field-lbl" style={{ margin: 0 }}>Floats from the series above</span>
    </label>
    </>
  );
}
