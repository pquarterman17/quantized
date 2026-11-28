// The legend corner picker as a self-contained value / onChange field: the
// Legend popup mounts it over its draft, and a docked panel card could mount
// it over the live setter (plan item 50, E11). It is the one place the corner
// list lives; the panel's LegendControls keeps its own copy until lane D.

import type { LegendPos } from "../../../store/useApp";
import { Select } from "../../primitives";

export const LEGEND_POS_OPTIONS: { value: LegendPos; label: string }[] = [
  { value: "auto", label: "Auto (least crowded)" },
  { value: "ne", label: "Top right" },
  { value: "nw", label: "Top left" },
  { value: "se", label: "Bottom right" },
  { value: "sw", label: "Bottom left" },
];

export default function LegendPositionField({ value, onChange }: { value: LegendPos; onChange: (pos: LegendPos) => void }) {
  return (
    <label className="qzk-field-lbl">
      Legend position
      <Select options={LEGEND_POS_OPTIONS} aria-label="Legend position" value={value} onChange={(e) => onChange(e.target.value as LegendPos)} />
    </label>
  );
}
