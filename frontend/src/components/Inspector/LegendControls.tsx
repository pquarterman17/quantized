// Legend visibility + corner position — one component shared by the Axes card
// and the Inspector's selection section (a selected legend shows exactly these
// controls), so the two can never drift apart.

import { Select } from "../primitives";
import { useApp, type LegendPos } from "../../store/useApp";

const LEGEND_POSITIONS: { value: LegendPos; label: string }[] = [
  { value: "auto", label: "Auto (least crowded)" },
  { value: "ne", label: "Top right" },
  { value: "nw", label: "Top left" },
  { value: "se", label: "Bottom right" },
  { value: "sw", label: "Bottom left" },
];

export default function LegendControls() {
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
      {showLegend && (
        <label className="qzk-field-lbl" style={{ marginTop: 2 }}>
          Legend position
          <Select
            options={LEGEND_POSITIONS}
            value={legendPos}
            onChange={(e) => setLegendPos(e.target.value as LegendPos)}
          />
        </label>
      )}
    </>
  );
}
