// Tabulate workshop — stat-set checkboxes (JMP_GAP_PLAN J6). A row of small
// checkboxes over the v2 stat catalog (lib/tabulate.STAT_KEYS); the checked
// subset drives the preview table's columns and both export paths. Thin —
// selection state lives in useTabulate.

import { STAT_KEYS, type StatKey } from "../../../lib/tabulate";
import { Checkbox } from "../../primitives";

export default function TabulateStatPicker({
  selected,
  onToggle,
}: {
  selected: readonly StatKey[];
  onToggle: (k: StatKey) => void;
}) {
  const set = new Set(selected);
  return (
    <div
      className="qzk-tabulate-stats"
      style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", marginTop: 8 }}
    >
      {STAT_KEYS.map((k) => (
        <Checkbox key={k} checked={set.has(k)} onChange={() => onToggle(k)}>
          <span style={{ fontSize: 11 }}>{k}</span>
        </Checkbox>
      ))}
    </div>
  );
}
