// The legend corner picker as a self-contained value / onChange field: the
// Legend popup mounts it over its draft, and a docked panel card could mount
// it over the live setter (plan item 50, E11). The corner list is shared with
// the panel's LegendControls (lib/legendPositions.ts).

import type { LegendPos } from "../../../store/useApp";
import { LEGEND_POS_OPTIONS } from "../../../lib/legendPositions";
import { Select } from "../../primitives";

export default function LegendPositionField({ value, onChange }: { value: LegendPos; onChange: (pos: LegendPos) => void }) {
  return (
    <label className="qzk-field-lbl">
      Legend position
      <Select options={LEGEND_POS_OPTIONS} aria-label="Legend position" value={value} onChange={(e) => onChange(e.target.value as LegendPos)} />
    </label>
  );
}
