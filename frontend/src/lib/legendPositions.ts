// The legend's corner choices: the one list the Legend popup and the right
// panel's legend controls both offer.

import type { LegendPos } from "../store/useApp";

export const LEGEND_POS_OPTIONS: { value: LegendPos; label: string }[] = [
  { value: "auto", label: "Auto (least crowded)" },
  { value: "ne", label: "Top right" },
  { value: "nw", label: "Top left" },
  { value: "se", label: "Bottom right" },
  { value: "sw", label: "Bottom left" },
];
