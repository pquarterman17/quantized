// A mirror column's header badge: the glyph and its link status (Linked,
// Missing, ...), the reason in the tooltip. Presentation only; the status is
// derived (lib/mirrorColumn.ts mirrorStatus) and never persisted.

import { columnMirror } from "../../../lib/glyphs";
import type { MirrorStatus } from "../../../lib/mirrorColumn";

export default function MirrorBadge({ status }: { status: MirrorStatus }) {
  return (
    <span
      className="qzk-mirror-badge"
      data-state={status.state}
      title={`Mirror column: ${status.detail}`}
      aria-label={`mirror column, ${status.label}${status.rowNote ? `, ${status.rowNote}` : ""}`}
    >
      {columnMirror} {status.label}
      {status.rowNote ? " · rows differ" : ""}
    </span>
  );
}
