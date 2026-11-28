// Plot details > Error bars: whether the curve draws its error column, and how
// (bars, band or box; cap, width, colour). The on/off is the draft's `errCol`,
// which Apply writes through `pickSeriesYError` (both the legacy pick and the
// error roles); the look is the curve's `errorBar` style.

import SeriesSymbolErrorControls from "../../../Inspector/SeriesSymbolErrorControls";
import { Checkbox } from "../../../primitives/Checkbox";
import type { CurveTabProps } from "./curveTabProps";

export default function ErrorBarsTab({
  channel, style, setSeriesStyle, ctx, errCol, setErrCol,
}: CurveTabProps & { errCol: number | null; setErrCol: (c: number | null) => void }) {
  // On only when there is a column to point at: an existing pick or the
  // dataset's default pairing (Origin Y-error / reflectometry dR).
  const canError = errCol != null || ctx.naturalErr != null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Checkbox
        checked={errCol != null}
        disabled={!canError}
        onChange={(c) => setErrCol(c ? (ctx.naturalErr ?? errCol ?? null) : null)}
      >
        Show error bars
      </Checkbox>
      {!canError && <div className="qzk-ds-meta">This dataset has no error column to draw; bind one in the Error columns card.</div>}
      <SeriesSymbolErrorControls
        channel={channel} style={style} setSeriesStyle={setSeriesStyle} markers={false} errors drawnColor={ctx.drawnColor} parts="errors"
      />
    </div>
  );
}
