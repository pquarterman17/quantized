// The two actions behind Ctrl+Backspace / Ctrl+Shift+Backspace and the Edit
// commands (lib/repeatKeys.ts is the eager key handler; this half pulls in the
// command runner, so it loads on demand). lib/lastAction.ts holds what is remembered.

import { lastDialogCommand, lastOpenedDialog, repeatLastAction, type RepeatOptions } from "./lastAction";
import { runAction, useCommands } from "../store/commands";
import { useApp } from "../store/useApp";

/** Re-run the last repeatable operation on the current selection. */
export async function runRepeatLast(opts?: RepeatOptions): Promise<void> {
  const { ok, message } = await repeatLastAction(opts);
  useApp.getState().setStatus(message, ok ? "ok" : "warn");
}

/** Reopen the last tool panel or dialog command. */
export function runReopenLastDialog(): void {
  const { setStatus } = useApp.getState();
  const opened = lastOpenedDialog();
  if (opened) {
    const why = opened.reopen();
    if (why) setStatus(`can't reopen ${opened.label}: ${why}`, "warn");
    return;
  }
  const cmd = lastDialogCommand(useCommands.getState().menuCommands);
  if (!cmd) return setStatus("no dialog to reopen yet", "warn");
  const off = typeof cmd.disabled === "function" ? cmd.disabled() : cmd.disabled === true;
  if (off) {
    const why = typeof cmd.disabledReason === "function" ? cmd.disabledReason() : cmd.disabledReason;
    return setStatus(`can't reopen ${cmd.label.replace(/…$/, "")}: ${why ?? "unavailable right now"}`, "warn");
  }
  runAction(cmd);
}
