// J2 Recode workshop: the LIVE old -> new mapping table (JMP_GAP_PLAN item 2's
// "live preview showing the old -> new mapping table before anything is
// committed"). One row per OLD level; typing a new label for a row calls
// `setGroup(label, [oldLevel])` on blur/Enter — typing the SAME label into
// two rows is how a MERGE happens (lib/recode.ts's `buildRecodePreview`
// dedupes by label automatically, so no separate "create a group" gesture is
// needed); typing back the level's own original text (or blanking it) reverts
// it to identity via `clearLevel`. Kept as its own component (not inlined in
// RecodePanel) purely for the workshop-pattern shape — RecodePanel has room
// under the component ceiling either way.

import { DataTable } from "../../primitives";
import { useRecode } from "../../../store/recode";
import type { RecodePreview } from "../../../lib/recode";

export default function RecodeMappingTable({ preview }: { preview: RecodePreview }) {
  const setGroup = useRecode((s) => s.setGroup);
  const clearLevel = useRecode((s) => s.clearLevel);

  const commit = (oldLevel: string, typed: string) => {
    const v = typed.trim();
    if (v === "" || v === oldLevel) clearLevel(oldLevel);
    else setGroup(v, [oldLevel]);
  };

  return (
    <DataTable
      columns={["Old level", "", "New level"]}
      rows={preview.rows.map((row) => [
        row.oldLevel,
        "→",
        <input
          // Remount when the RESOLVED value changes from outside this input
          // (e.g. Find/Replace regenerated the whole mapping) so the field
          // shows the fresh text; stable across the input's OWN keystrokes
          // (which don't touch the store until blur/Enter).
          key={`${row.oldLevel}:${row.newLevel}`}
          className="qz-input"
          style={{ width: "100%" }}
          defaultValue={row.newLevel}
          aria-label={`new level for ${row.oldLevel}`}
          onBlur={(e) => commit(row.oldLevel, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />,
      ])}
    />
  );
}
