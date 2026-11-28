// The plot's row-window chip (ROW_RANGE_CONTRACT 3.4): "rows 21-44 of 200", with
// a clear button. Mounted only while the focused plot has a range (its gate is
// in PlotStageOverlays), so it costs nothing otherwise. A range that no longer
// fits the sheet is not applied (the plot draws every row): the chip says so
// and carries the reason, never a silent fallback. It sits in the frame corner
// `placeLegend` picked for it (`data-wc`: least data, clear of the legend and readout).

import { plotRowWindow } from "../../lib/glyphs";
import { plotRowRangeState } from "../../lib/plotRowRangeState";
import { setPlotRowRange } from "../../store/plotRowRangeSet";
import { useApp } from "../../store/useApp";

/** `alt`: the stage showing this chip is not the XY plot, so the chip sits at the bottom-left (the XY plot's own chip
 *  is in the top corner, clear of the legend). `note`: what the window does NOT reach on a stage that otherwise honours
 *  it (a spatial panel set holding panels of other sheets, which a window of THIS sheet's rows cannot cut). */
export default function PlotRowRangeChip({ alt, note }: { alt?: boolean; note?: string } = {}) {
  const range = useApp((s) => s.rowRange);
  const rows = useApp((s) => s.datasets.find((d) => d.id === s.activeId)?.data.time.length ?? 0);
  const setStatus = useApp((s) => s.setStatus);
  if (!range) return null;
  const state = plotRowRangeState(range, rows);
  const { refusal } = state;
  const label = note ? `${state.label} · ${note}` : state.label;
  return (
    <div className={alt ? "qzk-rowchip qzk-rowchip-alt" : "qzk-rowchip"}>
      <div className="qzk-glass qzk-result-chip" role="status" title={refusal ?? (note ? `The plot draws only these worksheet rows, ${note}` : "The plot draws only these worksheet rows")}>
        <span className="g">{plotRowWindow}</span>
        <span className="v">{label}</span>
        <button
          aria-label="Clear plot row range"
          className="qzk-chip-reset"
          title="Draw every row"
          onClick={() => {
            setPlotRowRange(null);
            setStatus("Plot row range cleared: every row is drawn.");
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}
