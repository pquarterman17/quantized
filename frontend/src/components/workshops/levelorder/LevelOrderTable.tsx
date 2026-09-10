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

export default function LevelOrderTable({ data, channel, draft }: { data: DataStruct; channel: number; draft: number[] }) {
  const moveUp = useLevelOrder((s) => s.moveUp);
  const moveDown = useLevelOrder((s) => s.moveDown);

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
              aria-label={`move "${label}" up`}
              disabled={i === 0}
              onClick={() => moveUp(code)}
            >
              ▲
            </button>
            <button
              type="button"
              className="qz-btn qz-sm"
              aria-label={`move "${label}" down`}
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
