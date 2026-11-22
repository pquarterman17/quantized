// Bars for one series (Origin column / bar graph creation): None / Vertical /
// Horizontal over `SeriesStyle.bars`. The canvas draws it in lib/uplotBars.ts
// (horizontal turns the plot, lib/uplotOrient.ts); the export in
// calc/figure_bars.py + calc/figure_orient.py. The series colour above fills
// the bars. Turning bars on clears the markers and fill-under, as the
// plot-type gallery's bar tiles do.

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
  channel, style, setSeriesStyle,
}: {
  channel: number;
  style: SeriesStyle;
  setSeriesStyle: (channel: number, patch: Partial<SeriesStyle>, coalesce?: string) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
      <span className="qzk-field-lbl" style={{ margin: 0 }}>Bars</span>
      <Select
        options={OPTIONS}
        value={choiceOf(style.bars)}
        title="Draw this series as bars from zero at each X"
        aria-label="Bars"
        onChange={(e) => {
          const v = e.target.value as BarsChoice;
          if (v === "none") setSeriesStyle(channel, { bars: undefined });
          else setSeriesStyle(channel, { bars: v === "horizontal" ? "horizontal" : true, marker: false, fill: undefined });
        }}
      />
    </div>
  );
}
