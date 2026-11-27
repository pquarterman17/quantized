// The plot's row-window chip (ROW_RANGE_CONTRACT 3.4): "rows 21-44 of 200", with
// a clear button. Mounted only while the focused plot has a range (its gate is
// in PlotStageOverlays), so it costs nothing otherwise. A range that no longer
// fits the sheet is not applied (the plot draws every row): the chip says so
// and carries the reason, never a silent fallback.

import { plotRowWindow } from "../../lib/glyphs";
import { plotRowRangeState } from "../../lib/plotRowRangeState";
import { setPlotRowRange } from "../../store/plotRowRangeSet";
import { useApp } from "../../store/useApp";

export default function PlotRowRangeChip() {
  const range = useApp((s) => s.rowRange);
  const rows = useApp((s) => s.datasets.find((d) => d.id === s.activeId)?.data.time.length ?? 0);
  const setStatus = useApp((s) => s.setStatus);
  if (!range) return null;
  const { label, refusal } = plotRowRangeState(range, rows);
  return (
    <div className="qzk-result-chips" style={{ left: "calc(var(--qz-frame-left, 0px) + 8px)", transform: "none", alignItems: "flex-start" }}>
      <div className="qzk-glass qzk-result-chip" role="status" title={refusal ?? "The plot draws only these worksheet rows"}>
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
