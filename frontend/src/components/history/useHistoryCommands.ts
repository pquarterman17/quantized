// Undo/Redo (MAIN_PLAN #9): the command-registry counterpart to the
// snapshot-history slice (store/history.ts) — published into the shared
// command registry (`store/commands.ts`'s `useCommands`) so the Edit menu
// and the ⌘K palette both pick up "Undo <label>" / "Redo <label>" with ZERO
// lines added to appCommands.ts's pinned curated-actions list. Same "wire
// through the registry, never inline in the pinned list" pattern
// `windows/useWindowCommands` uses for the Window menu — see its header for
// the fuller rationale.
//
// Unlike the Window commands (static labels, published once on mount),
// Undo/Redo's LABELS must track the live stack top, so this hook
// re-publishes whenever the top history/future label changes (a reactive
// selector drives the publish effect, not a one-shot `useEffect(..., [])`).
// Both sources coexist in the registry via `setMenuCommands`'s per-source
// merge (commands.ts) — this hook's "history" key never clobbers
// useWindowCommands' "windows" key or vice versa.
//
// Also owns the actual Ctrl+Z / Ctrl+Shift+Z (Cmd on macOS) key handling —
// same precedent as useWindowCommands owning Ctrl+Tab / ⌘⇧N-D-W: an
// extracted feature that publishes its own commands also owns their key
// handling, rather than growing useGlobalShortcuts.ts's central switch.
// Native text undo in an input/textarea/contentEditable must keep working,
// so every handler here is guarded by the same `isEditing` check
// useGlobalShortcuts/useWindowCommands each carry locally.

import { useEffect } from "react";

import { useCommands, type Action } from "../../store/commands";
import { toast } from "../../store/toasts";
import { useApp } from "../../store/useApp";

function isEditing(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/** Undo the top history entry, or toast "nothing to undo" on an empty
 *  stack — the store action itself (`s.undo`) is a pure no-op when empty,
 *  so the messaging lives here, at the command layer (mirrors how
 *  appCommands' "Remove all…" checks `datasets.length` before acting). */
function runUndo(): void {
  const s = useApp.getState();
  const top = s.history[s.history.length - 1];
  if (!top) {
    toast("nothing to undo");
    return;
  }
  s.undo();
  toast(`undid: ${top.label}`);
}

function runRedo(): void {
  const s = useApp.getState();
  const top = s.future[s.future.length - 1];
  if (!top) {
    toast("nothing to redo");
    return;
  }
  s.redo();
  toast(`redid: ${top.label}`);
}

export function useHistoryCommands(): void {
  const undoLabel = useApp((s) => s.history[s.history.length - 1]?.label ?? null);
  const redoLabel = useApp((s) => s.future[s.future.length - 1]?.label ?? null);

  useEffect(() => {
    const actions: Action[] = [
      {
        id: "history-undo",
        group: "Edit",
        label: undoLabel ? `Undo ${undoLabel}` : "Undo",
        shortcut: "⌘Z",
        run: runUndo,
      },
      {
        id: "history-redo",
        group: "Edit",
        label: redoLabel ? `Redo ${redoLabel}` : "Redo",
        shortcut: "⌘⇧Z",
        run: runRedo,
      },
    ];
    useCommands.getState().setMenuCommands("history", actions);
  }, [undoLabel, redoLabel]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z" || isEditing(e.target)) return;
      e.preventDefault();
      if (e.shiftKey) runRedo();
      else runUndo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
