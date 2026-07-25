// Project trash view (MAIN_PLAN #32, slice 3's remaining UI).
//
// The trash store shipped with restore/purge and its eviction policy already
// tested; what it lacked was any way to SEE it, which made it a safety net
// nobody could find. This is that surface.
//
// Two deliberate choices about tone:
//
//   * Restore is one click, Delete Permanently asks. Trash exists to make
//     deletion recoverable, so the recovering action should be frictionless
//     and the irreversible one should not.
//   * The eviction rules are STATED, not implied. An entry silently vanishing
//     after seven days would teach users the trash cannot be trusted, which is
//     worse than not having one — so the panel says what it keeps.

import { useState } from "react";

import { TRASH_MAX_AGE_MS, TRASH_MAX_ENTRIES } from "../../../store/trash";
import { useApp } from "../../../store/useApp";
import ToolWindow from "../../overlays/ToolWindow";
import { Button } from "../../primitives";

/** Coarse "3d ago" age, matching the Recent menu's register. */
export function trashAge(at: number, nowMs: number): string {
  const h = Math.max(0, Math.round((nowMs - at) / 3_600_000));
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
}

export default function TrashPanel() {
  const setOpen = useApp((s) => s.setTrashOpen);
  const trash = useApp((s) => s.trash);
  const restore = useApp((s) => s.restoreFromTrash);
  const purge = useApp((s) => s.purgeTrash);
  const setStatus = useApp((s) => s.setStatus);
  // Confirmation is per-entry rather than a modal: a modal over a modal-ish
  // tool window is worse, and this keeps the destructive click two-step.
  const [confirming, setConfirming] = useState<string | null>(null);
  const now = Date.now();
  const days = Math.round(TRASH_MAX_AGE_MS / 86_400_000);

  return (
    <ToolWindow id="trash" title="Trash" width={340} onClose={() => setOpen(false)}>
      {trash.length === 0 ? (
        <div style={{ color: "var(--text-faint)" }}>
          Nothing deleted yet. Removed datasets land here so they can be brought
          back.
        </div>
      ) : (
        <>
          {trash.map((entry) => (
            <div
              key={entry.dataset.id}
              className="qz-meta-row"
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <span className="qzk-menu-trunc" style={{ flex: 1 }} title={entry.dataset.name}>
                {entry.dataset.name}
              </span>
              <span className="qz-shortcut">{trashAge(entry.at, now)}</span>
              <Button
                size="sm"
                onClick={() => {
                  const ok = restore(entry.dataset.id);
                  setStatus(
                    ok ? `restored ${entry.dataset.name}` : "that entry is no longer in the trash",
                  );
                }}
                title="Put this dataset back in the Library"
              >
                Restore
              </Button>
              {confirming === entry.dataset.id ? (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    purge(entry.dataset.id);
                    setConfirming(null);
                    setStatus(`permanently deleted ${entry.dataset.name}`);
                  }}
                  title="This cannot be undone"
                >
                  Sure?
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirming(entry.dataset.id)}
                  title="Delete permanently"
                >
                  ✕
                </Button>
              )}
            </div>
          ))}
          <div
            className="qzk-ds-meta"
            style={{ marginTop: 8, color: "var(--text-faint)" }}
          >
            Keeps the {TRASH_MAX_ENTRIES} most recent for {days} days. Raw source
            files are never touched.
          </div>
        </>
      )}
    </ToolWindow>
  );
}
