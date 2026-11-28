// Plot details > Error bars: whether the curve draws its error column, and how
// (bars, band or box; cap, width, colour). The on/off is the draft's `errCol`,
// which Apply writes through `pickSeriesYError` (both the legacy pick and the
// error roles); the look is the curve's `errorBar` style. The column is picked
// here too (the Channels card's "±" list: any column but this curve and X), so
// nothing sends the user to another card to bind one.

import { useApp } from "../../../../store/useApp";
import SeriesSymbolErrorControls from "../../../Inspector/SeriesSymbolErrorControls";
import { Checkbox } from "../../../primitives/Checkbox";
import { Select } from "../../../primitives";
import type { CurveTabProps } from "./curveTabProps";

export default function ErrorBarsTab({
  channel, style, setSeriesStyle, ctx, errCol, setErrCol,
}: CurveTabProps & { errCol: number | null; setErrCol: (c: number | null) => void }) {
  // On only when there is a column to point at: an existing pick or the
  // dataset's default pairing (Origin Y-error / reflectometry dR).
  const canError = errCol != null || ctx.naturalErr != null;
  const xKey = useApp((s) => s.xKey);
  const candidates = ctx.labels.map((label, j) => ({ label, j })).filter(({ j }) => j !== channel && j !== xKey);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Checkbox
        checked={errCol != null}
        disabled={!canError}
        onChange={(c) => setErrCol(c ? (ctx.naturalErr ?? errCol ?? null) : null)}
      >
        Show error bars
      </Checkbox>
      <label className="qzk-field-lbl" style={{ display: "grid", gridTemplateColumns: "100px 1fr", alignItems: "center", gap: 8 }}>
        <span>Error column</span>
        <Select
          aria-label="Error column"
          disabled={candidates.length === 0}
          value={errCol == null ? "" : String(errCol)}
          onChange={(e) => setErrCol(e.target.value === "" ? null : Number(e.target.value))}
          options={[{ value: "", label: "± none" }, ...candidates.map(({ label, j }) => ({ value: String(j), label: `± ${label}` }))]}
        />
      </label>
      <SeriesSymbolErrorControls
        channel={channel} style={style} setSeriesStyle={setSeriesStyle} markers={false} errors drawnColor={ctx.drawnColor} parts="errors"
      />
    </div>
  );
}
