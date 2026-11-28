// The plot's row-window chip (ROW_RANGE_CONTRACT 3.4): "rows 21-44 of 200", with
// a clear button. Mounted only while the focused plot has a range (its gate is
// in PlotStageOverlays), so it costs nothing otherwise. A range that no longer
// fits the sheet is not applied (the plot draws every row): the chip says so
// and carries the reason, never a silent fallback. It sits in the frame corner
// `placeLegend` picked for it (`data-wc`: least data, clear of the legend and readout).

import { plotRowWindow } from "../../lib/glyphs";
import { DRAWS_EVERY_ROW, plotRowRangeState } from "../../lib/plotRowRangeState";
import { rowRangeLabel } from "../../lib/rowRange";
import { setPlotRowRange } from "../../store/plotRowRangeSet";
import { useApp } from "../../store/useApp";

/** `drawsEvery`: the stage showing this chip (the polar map, a G15 plot) draws every row whatever the window, so the
 *  chip says so rather than claim a row set the plot does not show. Absent: the XY plot's own chip (top corner clear
 *  of the legend). A boolean: the other stages, which seat it at the bottom-left, and where `false` means the stage
 *  does honour the window. `note`: what the window does NOT reach on a stage that otherwise honours it (a spatial
 *  panel set holding panels of other sheets, which a window of THIS sheet's rows cannot cut). */
export default function PlotRowRangeChip({ drawsEvery, note }: { drawsEvery?: boolean; note?: string } = {}) {
  const range = useApp((s) => s.rowRange);
  const rows = useApp((s) => s.datasets.find((d) => d.id === s.activeId)?.data.time.length ?? 0);
  const setStatus = useApp((s) => s.setStatus);
  if (!range) return null;
  const state = plotRowRangeState(range, rows);
  const { refusal } = state;
  const label = drawsEvery ? `${rowRangeLabel(range)} · ${DRAWS_EVERY_ROW}` : note ? `${state.label} · ${note}` : state.label;
  return (
    <div className={drawsEvery === undefined ? "qzk-rowchip" : "qzk-rowchip qzk-rowchip-alt"}>
      <div className="qzk-glass qzk-result-chip" role="status" title={drawsEvery ? `The window is set on this sheet, but ${DRAWS_EVERY_ROW}: switch to the XY plot to see only these rows.` : refusal ?? (note ? `The plot draws only these worksheet rows, ${note}` : "The plot draws only these worksheet rows")}>
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
