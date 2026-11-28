// Plot details > Marks: size by a column, drop lines, rug, line connect
// (straight / spline) and the stack total, over the popup's draft.

import SeriesMarkMapControls from "../../../Inspector/SeriesMarkMapControls";
import type { CurveTabProps } from "./curveTabProps";

export default function MarksTab({ channel, style, setSeriesStyle }: CurveTabProps) {
  return <SeriesMarkMapControls channel={channel} style={style} setSeriesStyle={setSeriesStyle} />;
}
