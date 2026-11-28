// Legend visibility + corner position — one component shared by the Axes card
// and the Inspector's selection section (a selected legend shows exactly these
// controls), so the two can never drift apart.
// Plan item 50: in "popup" mode the Selection section does not mount it and the
// Axes card mounts it with `corner={false}` (the corner lives in the Legend popup).

import { LEGEND_POS_OPTIONS } from "../../lib/legendPositions";
import { Select } from "../primitives";
import { useApp, type LegendPos } from "../../store/useApp";


export default function LegendControls({ corner = true }: { /** False: only the on/off toggle (the popup holds the corner). */ corner?: boolean }) {
  const showLegend = useApp((s) => s.showLegend);
  const setShowLegend = useApp((s) => s.setShowLegend);
  const legendPos = useApp((s) => s.legendPos);
  const setLegendPos = useApp((s) => s.setLegendPos);
  return (
    <>
      <label className="qz-check">
        <input type="checkbox" checked={showLegend} onChange={(e) => setShowLegend(e.target.checked)} />
        Legend
      </label>
      {showLegend && corner && (
        <label className="qzk-field-lbl" style={{ marginTop: 2 }}>
          Legend position
          <Select
            options={LEGEND_POS_OPTIONS}
            value={legendPos}
            onChange={(e) => setLegendPos(e.target.value as LegendPos)}
          />
        </label>
      )}
    </>
  );
}
