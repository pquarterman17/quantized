// Plot details > Fill and bars: fill under or between curves, colour by a
// column, row states, and bars (including a floating bar, which also edits the
// series above: the draft takes both writes and Apply commits them as one step).

import type { SeriesStyle } from "../../../../lib/types";
import SeriesBarsControl from "../../../Inspector/SeriesBarsControl";
import SeriesFillColorControls from "../../../Inspector/SeriesFillColorControls";
import type { CurveTabProps } from "./curveTabProps";

export default function FillBarsTab({
  channel, style, setSeriesStyle, ctx, aboveStyle,
}: CurveTabProps & { aboveStyle?: SeriesStyle }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <SeriesFillColorControls channel={channel} style={style} labels={ctx.labels} setSeriesStyle={setSeriesStyle} />
      <SeriesBarsControl channel={channel} style={style} setSeriesStyle={setSeriesStyle} above={ctx.above} aboveStyle={aboveStyle} />
    </div>
  );
}
