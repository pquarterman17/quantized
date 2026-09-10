// Group O-2b: the reorder panel's LIVE draft-order table. One row per level
// of the open column, in the DRAFT's current sequence (not re-sorted by
// code or label — the row order IS the thing being edited). Kept as its own
// component purely for the workshop-pattern shape (`RecodeMappingTable`'s
// precedent) — `LevelOrderPanel` has room under the component ceiling
// either way.

import { DataTable } from "../../primitives/DataTable";
import { groupLevelLabel } from "../../../lib/categorical";
import type { DataStruct } from "../../../lib/types";
import { useLevelOrder } from "../../../store/levelOrder";

// Review round LOW 9: two levels may legitimately share a display label
// (`cat_levels {0: ["A", "A"]}` is not corrupt — a Recode can merge names
// without merging codes). Reordering still works, because every control is
// keyed by CODE, but two identical `move "A" up` labels are ambiguous to a
// screen reader and would make any `getByLabelText` query throw. Disambiguate
// with the code — which IS the level's identity — but only for the labels
// that actually collide, so the common case stays plain prose.
function ariaFor(dir: "up" | "down", label: string, code: number, byLabel: Map<string, number>): string {
  const suffix = (byLabel.get(label) ?? 0) > 1 ? ` (level ${code})` : "";
  return `move "${label}"${suffix} ${dir}`;
}

export default function LevelOrderTable({ data, channel, draft }: { data: DataStruct; channel: number; draft: number[] }) {
  const moveUp = useLevelOrder((s) => s.moveUp);
  const moveDown = useLevelOrder((s) => s.moveDown);
  const byLabel = new Map<string, number>();
  for (const code of draft) {
    const l = groupLevelLabel(data, channel, code);
    byLabel.set(l, (byLabel.get(l) ?? 0) + 1);
  }

  return (
    <DataTable
      columns={["Level", "Order"]}
      rows={draft.map((code, i) => {
        const label = groupLevelLabel(data, channel, code);
        return [
          label,
          <div key="order" style={{ display: "flex", gap: 4 }}>
            <button
              type="button"
              className="qz-btn qz-sm"
              aria-label={ariaFor("up", label, code, byLabel)}
              disabled={i === 0}
              onClick={() => moveUp(code)}
            >
              ▲
            </button>
            <button
              type="button"
              className="qz-btn qz-sm"
              aria-label={ariaFor("down", label, code, byLabel)}
              disabled={i === draft.length - 1}
              onClick={() => moveDown(code)}
            >
              ▼
            </button>
          </div>,
        ];
      })}
    />
  );
}
