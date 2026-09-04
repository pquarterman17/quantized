// One Trash row (extracted from TrashPanel.tsx to keep it under the .tsx
// component ceiling as P3.7 widened the panel to every entry kind — see
// TrashPanel.tsx's own header for the restore/purge asymmetry this keeps).

import { useState } from "react";

import { formatTrashBytes, trashAge } from "../../../lib/trashSummary";
import { trashEntryId, type TrashEntry } from "../../../store/trash";
import { useApp } from "../../../store/useApp";
import { Badge, Button } from "../../primitives";

/** Display name for any entry kind — the one thing every payload object has
 *  in common. */
function entryName(entry: TrashEntry): string {
  switch (entry.kind) {
    case "dataset": return entry.dataset.name;
    case "editableFigure": return entry.document.name;
    case "figureDoc": return entry.doc.name;
    case "page": return entry.page.name;
    case "report": return entry.report.name;
    case "folder": return entry.folders[0].name;
  }
}

const KIND_BADGE: Record<TrashEntry["kind"], string> = {
  dataset: "Data",
  editableFigure: "Figure",
  figureDoc: "Pub. figure",
  page: "Page",
  report: "Report",
  folder: "Folder",
};

export default function TrashRow({ entry, now }: { entry: TrashEntry; now: number }) {
  const restore = useApp((s) => s.restoreFromTrash);
  const purge = useApp((s) => s.purgeTrash);
  const setStatus = useApp((s) => s.setStatus);
  const [confirming, setConfirming] = useState(false);
  const id = trashEntryId(entry);
  const name = entryName(entry);

  return (
    <div className="qz-meta-row" style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <Badge>{KIND_BADGE[entry.kind]}</Badge>
      <span className="qzk-menu-trunc" style={{ flex: 1 }} title={name}>
        {name}
      </span>
      <span className="qz-shortcut">{formatTrashBytes(entry.bytes)}</span>
      <span className="qz-shortcut">{trashAge(entry.at, now)}</span>
      <Button
        size="sm"
        onClick={() => {
          restore(id)
            .then((result) => {
              setStatus(result.ok ? (result.note ? `restored ${name} — ${result.note}` : `restored ${name}`) : result.reason);
            })
            // The restore crosses a dynamic import (store/trashRestore.ts);
            // a stale tab after a rebuild or a dropped connection rejects
            // the chunk load, and a silent click is the wrong answer
            // (self-review on #292).
            .catch(() => setStatus(`could not restore ${name} — reload and try again`));
        }}
        title="Put this back where it was"
      >
        Restore
      </Button>
      {confirming ? (
        <Button
          size="sm"
          variant="danger"
          // Review finding on #292: one of many "Sure?" buttons in a list is
          // indistinguishable to assistive tech — the name carries the row.
          aria-label={`Confirm permanent delete: ${name}`}
          onClick={() => {
            purge(id);
            setConfirming(false);
            setStatus(`permanently deleted ${name}`);
          }}
          title="This cannot be undone"
        >
          Sure?
        </Button>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Delete permanently: ${name}`}
          onClick={() => setConfirming(true)}
          title="Delete permanently"
        >
          ✕
        </Button>
      )}
    </div>
  );
}
