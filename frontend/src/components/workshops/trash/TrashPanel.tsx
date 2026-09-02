// Project trash view (MAIN_PLAN #32; widened to every deletable kind by
// PRIMARY_SOFTWARE_AUDIT_PLAN P3.7).
//
// Two deliberate choices about tone, unchanged since #32:
//
//   * Restore is one click, Delete Permanently asks. Trash exists to make
//     deletion recoverable, so the recovering action should be frictionless
//     and the irreversible one should not.
//   * The eviction rules are STATED, not implied. An entry silently vanishing
//     after seven days would teach users the trash cannot be trusted, which is
//     worse than not having one — so the panel says what it keeps.
//
// P3.7 adds a THIRD tone choice: emptying the WHOLE trash is more consequential
// than any one row's permanent delete (it can easily be more data than the
// user remembers is even in there), so it gets its own confirm with a PURGE
// PREVIEW naming exactly what would be lost — not just "are you sure?".

import { trashSummary, purgePreviewLine } from "../../../lib/trashSummary";
import { TRASH_MAX_AGE_MS, TRASH_MAX_BYTES, TRASH_MAX_ENTRIES, trashEntryId } from "../../../store/trash";
import { useApp } from "../../../store/useApp";
import { askConfirm } from "../../overlays/ConfirmDialog";
import ToolWindow from "../../overlays/ToolWindow";
import { Button } from "../../primitives";
import TrashRow from "./TrashRow";

export default function TrashPanel() {
  const setOpen = useApp((s) => s.setTrashOpen);
  const trash = useApp((s) => s.trash);
  const purgeAll = useApp((s) => s.purgeTrash);
  const setStatus = useApp((s) => s.setStatus);
  const now = Date.now();
  const summary = trashSummary(trash, now);
  const days = Math.round(TRASH_MAX_AGE_MS / 86_400_000);
  const maxMiB = Math.round(TRASH_MAX_BYTES / (1024 * 1024));

  const emptyTrash = async () => {
    const ok = await askConfirm(
      "Empty trash?",
      `This permanently removes ${purgePreviewLine(summary, now)}. This cannot be undone.`,
      "Empty trash",
      true,
    );
    if (!ok) return;
    purgeAll();
    setStatus(`emptied trash (${summary.count} item${summary.count === 1 ? "" : "s"})`);
  };

  return (
    <ToolWindow id="trash" title="Trash" width={380} onClose={() => setOpen(false)}>
      {trash.length === 0 ? (
        <div style={{ color: "var(--text-faint)" }}>
          Nothing deleted yet. Removed datasets, figures, pages, reports, and
          folders land here so they can be brought back.
        </div>
      ) : (
        <>
          <div
            className="qzk-ds-meta"
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}
          >
            <span>{purgePreviewLine(summary, now)}</span>
            <Button size="sm" variant="danger" onClick={() => void emptyTrash()} title="Permanently remove everything in the trash">
              Empty trash
            </Button>
          </div>
          {trash.map((entry) => (
            <TrashRow key={trashEntryId(entry)} entry={entry} now={now} />
          ))}
          <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--text-faint)" }}>
            Keeps the {TRASH_MAX_ENTRIES} most recent, up to {days} days old and
            {" "}{maxMiB} MiB total. Raw source files are never touched.
          </div>
        </>
      )}
    </ToolWindow>
  );
}
