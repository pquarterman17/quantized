// "Repeat last action" (Ctrl+Backspace in Origin) and "Reopen last dialog"
// (Ctrl+Shift+Backspace): what the app last did, and how to do it again.
//
// REPEAT is deliberately narrow. Only an operation that carries its own
// settings and knows how to re-run on a new target registers itself
// (`rememberRepeat`: today the single-input transforms of lib/repeatTransform.ts,
// which `runTransform` records). Everything else fails closed with a plain
// message. The "last action" is the latest of two things: a command run through
// `runAction` (noted by `noteCommand`, which DROPS any older repeatable, so
// the chord never silently re-runs something older than what the user last
// did) or a repeatable operation registered after it.
//
// REOPEN reopens the last command that opens a tool panel or dialog (a command
// whose label ends in an ellipsis: the app's own "this opens something"
// convention). Tools keep their own inputs in their stores, so reopening the
// same command shows them as they were left. A dialog opened from a menu with
// no command registers itself (`rememberDialog`) only when it can be reopened
// safely: lib/dialogReopen.ts lists which do and which stay out.

import type { Action } from "../store/commands";

export interface RepeatOptions {
  reverse?: boolean;
}

export interface RepeatEntry {
  label: string;
  /** Re-run with the recorded settings on the current selection; `reverse` takes the selected inputs in the opposite order. */
  run: (opts?: RepeatOptions) => Promise<void> | void;
}

/** A dialog opened from a menu rather than a command (lib/dialogReopen.ts).
 *  `reopen` re-resolves its target from the live state and returns the reason
 *  it can't be reopened safely, or nothing once it has opened. */
export interface DialogEntry {
  label: string;
  reopen: () => string | void;
}

/** The commands that must not count as "the last action" themselves. */
const EXEMPT = new Set(["repeat-last-action", "reopen-last-dialog", "palette"]);

let lastCommand: { label: string } | null = null;
let lastDialog: Action | null = null;
let openedDialog: DialogEntry | null = null;
let repeatable: RepeatEntry | null = null;

/** Does this command open a tool panel or dialog (and is safe to reopen by key)? */
export function opensDialog(a: Pick<Action, "label" | "danger" | "perEntity">): boolean {
  return a.label.endsWith("…") && !a.danger && !a.perEntity;
}

/** Called by `runAction` for every command that runs. */
export function noteCommand(a: Action): void {
  if (EXEMPT.has(a.id)) return;
  lastCommand = { label: a.label };
  repeatable = null;
  if (opensDialog(a)) {
    lastDialog = a;
    openedDialog = null;
  }
}

/** An operation that can be repeated registers here once it has succeeded. */
export function rememberRepeat(entry: RepeatEntry): void {
  repeatable = entry;
}

/** A menu-opened dialog registers here when it opens; the latest dialog wins. */
export function rememberDialog(entry: DialogEntry): void {
  openedDialog = entry;
  lastDialog = null;
}

/** The menu-opened dialog to reopen, when it is newer than the last dialog command. */
export const lastOpenedDialog = (): DialogEntry | null => openedDialog;

/** The plain-language outcome of a repeat request, for the status line. */
export async function repeatLastAction(opts?: RepeatOptions): Promise<{ ok: boolean; message: string }> {
  if (!repeatable) {
    return {
      ok: false,
      message: lastCommand
        ? `can't repeat "${lastCommand.label.replace(/…$/, "")}": only data transforms (signal processing, resample, join, SIMS, reshape) can be repeated`
        : "nothing to repeat yet: run a signal-processing or resample step first",
    };
  }
  const entry = repeatable;
  try {
    await entry.run(opts);
    return { ok: true, message: `repeated ${entry.label}${opts?.reverse ? " with the inputs reversed" : ""}` };
  } catch (e) {
    return { ok: false, message: `repeat of ${entry.label} failed: ${e instanceof Error ? e.message : "error"}` };
  }
}

/** The command to reopen, preferring its freshest published copy by id. */
export function lastDialogCommand(fresh: readonly Action[] = []): Action | null {
  return lastDialog ? (fresh.find((a) => a.id === lastDialog!.id) ?? lastDialog) : null;
}

export function resetLastActionForTests(): void {
  lastCommand = null;
  lastDialog = null;
  openedDialog = null;
  repeatable = null;
}
